import type { SkillInstaller, ToolInstaller } from "@clawbot/agent";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { loadAuthConfig } from "../config/auth.js";
import type { LoginManager } from "../login/login-manager.js";
import type { McpManager } from "../mcp/manager.js";
import {
  observabilityService,
  type ObservabilityRouteService,
} from "../observability/service.js";
import type { BotRuntime } from "../runtime.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLoginRoutes } from "./routes/login.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerModelConfigRoutes } from "./routes/model-config.js";
import { registerObservabilityRoutes } from "./routes/observability.js";
import { registerScheduledTaskRoutes } from "./routes/scheduled-tasks.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerTapeRoutes } from "./routes/tape.js";
import { registerToolRoutes } from "./routes/tools.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";

export interface ApiDependencies {
  runtime: BotRuntime;
  loginManager: LoginManager;
  toolInstaller: ToolInstaller;
  skillInstaller: SkillInstaller;
  mcpManager: McpManager;
  observability?: ObservabilityRouteService;
  startedAt: Date;
}

export function createApiApp(dependencies: ApiDependencies) {
  const app = new Hono();
  const authConfig = loadAuthConfig();
  const observability = dependencies.observability ?? observabilityService;

  app.use(
    "*",
    cors({
      origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    })
  );
  app.use("*", logger());

  // Register auth routes (no JWT required)
  if (authConfig) {
    registerAuthRoutes(app, authConfig);
  }

  // Register webhook routes (use their own Bearer token auth, not JWT)
  registerWebhookRoutes(app);

  // Apply JWT middleware to all API routes except webhook delivery endpoint
  if (authConfig) {
    app.use("/api/*", async (c, next) => {
      // POST /api/webhooks is the webhook delivery endpoint, uses its own Bearer token auth
      if (c.req.method === "POST" && c.req.path === "/api/webhooks") {
        await next();
        return;
      }
      const middleware = createAuthMiddleware(authConfig.jwtSecret);
      return middleware(c, next);
    });
  }

  registerHealthRoutes(app, dependencies);
  registerAccountRoutes(app);
  registerConversationRoutes(app);
  registerMessageRoutes(app);
  registerLoginRoutes(app, dependencies.loginManager);
  registerToolRoutes(app, dependencies.toolInstaller);
  registerSkillRoutes(app, dependencies.skillInstaller, dependencies.toolInstaller);
  registerMcpRoutes(app, dependencies.mcpManager);
  registerModelConfigRoutes(app);
  registerObservabilityRoutes(app, observability);
  registerScheduledTaskRoutes(app);
  registerTapeRoutes(app);

  app.onError((error, c) => {
    console.error("[api] unhandled error", error);
    return c.json({ error: error instanceof Error ? error.message : "internal error" }, 500);
  });

  return app;
}
