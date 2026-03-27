import type { Hono } from "hono";
import type { LoginManager } from "../../login/login-manager.js";

export function registerLoginRoutes(app: Hono, loginManager: LoginManager) {
  app.post("/api/login/start", async (c) => {
    return c.json({ data: await loginManager.start() });
  });

  app.get("/api/login/status", (c) => {
    return c.json({ data: loginManager.getState() });
  });

  app.post("/api/login/cancel", (c) => {
    return c.json({ data: loginManager.cancel() });
  });
}
