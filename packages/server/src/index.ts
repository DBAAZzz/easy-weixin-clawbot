import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApiApp } from "./api/index.js";
import { mcpToolRegistry, skillInstaller, toolInstaller, validateConfig } from "./ai.js";
import { upsertAccount } from "./db/accounts.js";
import { createLoginManager } from "./login/login-manager.js";
import { createMcpManager } from "./mcp/manager.js";
import { observabilityService } from "./observability/service.js";
import { createBotRuntime } from "./runtime.js";
import { schedulerManager } from "@clawbot/agent";
import { purgeCompacted } from "@clawbot/agent/tape";

validateConfig();

const mcpManager = createMcpManager(mcpToolRegistry);
await mcpManager.bootstrap();

const runtime = createBotRuntime();
await runtime.bootstrap();
await schedulerManager.bootstrap().catch((error) => {
  console.warn("[scheduler] bootstrap failed:", error);
});
await observabilityService.cleanupExpired().catch((error) => {
  console.warn("[observability] cleanup failed during startup", error);
});

const observabilityCleanupTimer = setInterval(() => {
  void observabilityService.cleanupExpired().catch((error) => {
    console.warn("[observability] scheduled cleanup failed", error);
  });
  void purgeCompacted(30).then((count) => {
    if (count > 0) console.log(`[tape] purged ${count} compacted entries`);
  }).catch((error) => {
    console.warn("[tape] scheduled purge failed", error);
  });
}, 12 * 60 * 60 * 1000);
observabilityCleanupTimer.unref?.();

const loginManager = createLoginManager({
  onSuccess: async (accountId) => {
    await upsertAccount(accountId);
    runtime.ensureAccountStarted(accountId);
  },
});

const startedAt = new Date();
const app = createApiApp({
  runtime,
  loginManager,
  toolInstaller,
  skillInstaller,
  mcpManager,
  startedAt,
});

const port = Number.parseInt(process.env.API_PORT ?? "3001", 10);
const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`HTTP API listening on http://localhost:${port}`);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`Received ${signal}, shutting down...`);
  await schedulerManager.shutdown();
  await mcpManager.shutdown();
  await runtime.shutdown();
  await observabilityService.flush().catch((error) => {
    console.warn("[observability] flush failed during shutdown", error);
  });
  clearInterval(observabilityCleanupTimer);
  server.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
