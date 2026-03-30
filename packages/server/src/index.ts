import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApiApp } from "./api/index.js";
import { mcpToolRegistry, skillInstaller, toolInstaller, validateConfig } from "./ai.js";
import { upsertAccount } from "./db/accounts.js";
import { createLoginManager } from "./login/login-manager.js";
import { createMcpManager } from "./mcp/manager.js";
import { createBotRuntime } from "./runtime.js";

validateConfig();

const mcpManager = createMcpManager(mcpToolRegistry);
await mcpManager.bootstrap();

const runtime = createBotRuntime();
await runtime.bootstrap();

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
  await mcpManager.shutdown();
  await runtime.shutdown();
  server.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
