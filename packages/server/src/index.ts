import "./config/load-env.js";
import { serve } from "@hono/node-server";
import { schedulerManager, startHeartbeat, stopHeartbeat } from "@clawbot/agent";
import { purgeCompacted } from "@clawbot/agent/tape";
import { createApiApp } from "./api/index.js";
import { mcpToolRegistry, skillInstaller, toolInstaller, runtimeProvisioner, validateConfig } from "./ai.js";
import { createLoginManager } from "./login/login-manager.js";
import { createModuleLogger, getErrorFields } from "./logger.js";
import { createMcpManager } from "./mcp/manager.js";
import { observabilityService } from "./observability/service.js";
import { createBotRuntime } from "./runtime.js";
import { appSettingsService } from "./settings/service.js";

validateConfig();

const bootstrapLogger = createModuleLogger("bootstrap");

await appSettingsService.bootstrap();

const mcpManager = createMcpManager(mcpToolRegistry);
await mcpManager.bootstrap();

const runtime = createBotRuntime();
await runtime.bootstrap();
await schedulerManager.bootstrap().catch((error) => {
  bootstrapLogger.warn(
    { ...getErrorFields(error), subsystem: "scheduler" },
    "调度器启动失败",
  );
});
startHeartbeat();
await observabilityService.cleanupExpired().catch((error) => {
  bootstrapLogger.warn(
    { ...getErrorFields(error), subsystem: "observability" },
    "启动阶段清理可观测数据失败",
  );
});

const observabilityCleanupTimer = setInterval(() => {
  void observabilityService.cleanupExpired().catch((error) => {
    bootstrapLogger.warn(
      { ...getErrorFields(error), subsystem: "observability" },
      "定时清理可观测数据失败",
    );
  });
  void purgeCompacted(30)
    .then((count) => {
      if (count > 0) {
        bootstrapLogger.info(
          { subsystem: "tape", purgedCount: count },
          "已清理压缩后的 Tape 记录",
        );
      }
    })
    .catch((error) => {
      bootstrapLogger.warn(
        { ...getErrorFields(error), subsystem: "tape" },
        "定时清理 Tape 记录失败",
      );
    });
}, 12 * 60 * 60 * 1000);
observabilityCleanupTimer.unref?.();

const loginManager = createLoginManager({
  onSuccess: async (accountId) => {
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
  provisioner: runtimeProvisioner,
  startedAt,
});

const port = Number.parseInt(process.env.API_PORT ?? "8028", 10);
const server = serve({
  fetch: app.fetch,
  port,
});

bootstrapLogger.info({ port }, "HTTP API 服务已启动");

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;

  bootstrapLogger.info({ signal }, "收到关闭信号，准备停止服务");
  stopHeartbeat();
  await schedulerManager.shutdown();
  await mcpManager.shutdown();
  await runtime.shutdown();
  await observabilityService.flush().catch((error) => {
    bootstrapLogger.warn(
      { ...getErrorFields(error), subsystem: "observability" },
      "关闭阶段刷新可观测数据失败",
    );
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
