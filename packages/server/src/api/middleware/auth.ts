import type { MiddlewareHandler } from "hono";
import { verifyToken } from "../../auth/jwt.js";

export function createAuthMiddleware(jwtSecret: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);

    try {
      const payload = verifyToken(token, jwtSecret);
      c.set("user", payload.username);
      await next();
    } catch (error) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
  };
}
