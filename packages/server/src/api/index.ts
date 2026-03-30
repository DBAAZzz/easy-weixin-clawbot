import type { MiddlewareHandler } from "hono";
import type { SkillInstaller, ToolInstaller } from "@clawbot/agent";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { LoginManager } from "../login/login-manager.js";
import type { McpManager } from "../mcp/manager.js";
import type { BotRuntime } from "../runtime.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerConversationRoutes } from "./routes/conversations.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerLoginRoutes } from "./routes/login.js";
import { registerMcpRoutes } from "./routes/mcp.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerToolRoutes } from "./routes/tools.js";

export interface ApiDependencies {
  runtime: BotRuntime;
  loginManager: LoginManager;
  toolInstaller: ToolInstaller;
  skillInstaller: SkillInstaller;
  mcpManager: McpManager;
  startedAt: Date;
}

const auth: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    await next();
    return;
  }

  const secret = process.env.API_SECRET;
  if (!secret) {
    return c.json({ error: "API_SECRET is not configured" }, 500);
  }

  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token !== secret) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
};

export function createApiApp(dependencies: ApiDependencies) {
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    })
  );
  app.use("*", logger());
  app.use("/api/*", auth);

  registerHealthRoutes(app, dependencies);
  registerAccountRoutes(app);
  registerConversationRoutes(app);
  registerMessageRoutes(app);
  registerLoginRoutes(app, dependencies.loginManager);
  registerToolRoutes(app, dependencies.toolInstaller);
  registerSkillRoutes(app, dependencies.skillInstaller, dependencies.toolInstaller);
  registerMcpRoutes(app, dependencies.mcpManager);

  app.onError((error, c) => {
    console.error("[api] unhandled error", error);
    return c.json({ error: error instanceof Error ? error.message : "internal error" }, 500);
  });

  return app;
}
