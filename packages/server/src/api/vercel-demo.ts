import type { Hono } from "hono";
import { handle } from "hono/vercel";
import "../config/load-env.js";
import { isDemoMode } from "../config/demo-mode.js";
import { migratePlaintextSecrets } from "../db/secret-migrations.js";
import { createLoginManager } from "../login/login-manager.js";
import { createModuleLogger, getErrorFields } from "../logger.js";
import { SKILLS_BUILTIN_DIR, SKILLS_USER_DIR } from "../paths.js";
import {
  createApiApp,
  type ApiDependencies,
} from "./index.js";
import {
  mcpToolRegistry,
  runtimeProvisioner,
  skillInstaller,
  validateConfig,
} from "../ai.js";
import { createMcpManager } from "../mcp/manager.js";
import { createBotRuntime } from "../runtime.js";
import { seedDemoData } from "../seed/demo-seed.js";
import { appSettingsService } from "../settings/service.js";

/**
 * Vercel serverless demo entrypoint.
 *
 * Serves the regular Hono API app as a serverless function with DEMO_MODE
 * data. Differences from the long-running `src/index.ts` bootstrap:
 * - no WeChat runtime bootstrap (demo accounts have no credentials anyway),
 * - no scheduler / RSS / heartbeat timers (serverless has no background time),
 * - no MCP bootstrap (the demo server row is disabled),
 * - the demo seed runs once per instance with `skipIfPresent`, so cold starts
 *   never rewrite rows another warm instance is serving.
 *
 * Requires a reachable Postgres via DATABASE_URL / DIRECT_URL and the demo
 * auth/credential env vars — see docs/2026-09-05_00_34_vercel-demo-deployment.md.
 */

const serverlessLogger = createModuleLogger("vercel-demo");

let appPromise: Promise<Hono> | undefined;

async function buildDemoApp(): Promise<Hono> {
  if (!isDemoMode()) {
    serverlessLogger.warn(
      "DEMO_MODE 未开启：serverless 入口仍会启动 API，但不会写入演示数据。",
    );
  }

  validateConfig();
  await migratePlaintextSecrets();
  await appSettingsService.bootstrap();

  if (isDemoMode()) {
    await seedDemoData({ skipIfPresent: true }).catch((error) => {
      serverlessLogger.error(
        { ...getErrorFields(error), subsystem: "demo-seed" },
        "演示数据初始化失败",
      );
    });
  }

  await skillInstaller.initialize(SKILLS_BUILTIN_DIR, SKILLS_USER_DIR);

  const dependencies: ApiDependencies = {
    // Constructed but never bootstrapped: no WeChat connections are started.
    runtime: createBotRuntime(),
    loginManager: createLoginManager({
      onSuccess: () => Promise.resolve(),
    }),
    skillInstaller,
    // Constructed but never bootstrapped: disabled demo servers stay offline.
    mcpManager: createMcpManager(mcpToolRegistry),
    provisioner: runtimeProvisioner,
    startedAt: new Date(),
  };

  serverlessLogger.info("serverless demo API 已就绪");
  return createApiApp(dependencies);
}

export async function getDemoApp(): Promise<Hono> {
  appPromise ??= buildDemoApp();
  return appPromise;
}

/**
 * Default export wired as `api/[[route]].ts` in the Vercel deployment. Vercel
 * Node functions pass a web-standard Request, which is what `handle` expects.
 */
const vercelDemoHandler = async (req: Request): Promise<Response> => {
  const app = await getDemoApp();
  return handle(app)(req);
};

export default vercelDemoHandler;
