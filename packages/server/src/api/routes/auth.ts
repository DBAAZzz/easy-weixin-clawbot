import type { Hono } from "hono";
import type { AuthConfig } from "../../config/auth.js";
import { generateToken } from "../../auth/jwt.js";

export function registerAuthRoutes(app: Hono, authConfig: AuthConfig) {
  app.post("/api/auth/login", async (c) => {
    const body = await c.req.json();
    const { username, password } = body;

    if (!username || !password) {
      return c.json({ error: "Missing username or password" }, 400);
    }

    if (username !== authConfig.username || password !== authConfig.password) {
      return c.json({ error: "Invalid credentials" }, 401);
    }

    const token = generateToken(username, authConfig);

    return c.json({
      data: {
        token,
        expiresIn: authConfig.tokenExpiry,
      }
    });
  });
}
