import { createHash, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import type { AuthConfig } from "../../config/auth.js";
import { generateToken } from "../../auth/jwt.js";
import { createLoginRateLimiter } from "../../auth/login-rate-limiter.js";
import { createModuleLogger } from "../../logger.js";

const authLogger = createModuleLogger("auth");

/**
 * Compare via SHA-256 digests so the comparison is constant-time and does not
 * leak length; timingSafeEqual itself throws on mismatched buffer lengths.
 */
function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf-8").digest();
  const digestB = createHash("sha256").update(b, "utf-8").digest();
  return timingSafeEqual(digestA, digestB);
}

export function registerAuthRoutes(app: Hono, authConfig: AuthConfig) {
  const rateLimiter = createLoginRateLimiter();

  app.post("/api/auth/login", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const { username, password } =
      (body as { username?: unknown; password?: unknown } | null) ?? {};

    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return c.json({ error: "Missing username or password" }, 400);
    }

    const retryAfter = rateLimiter.check(username);
    if (retryAfter !== null) {
      authLogger.warn({ username }, "登录尝试过于频繁，已临时限制");
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "Too many failed login attempts. Try again later." }, 429);
    }

    const usernameMatches = safeEqual(username, authConfig.username);
    const passwordMatches = safeEqual(password, authConfig.password);

    if (!usernameMatches || !passwordMatches) {
      rateLimiter.recordFailure(username);
      authLogger.warn({ username }, "登录失败：用户名或密码错误");
      return c.json({ error: "Invalid credentials" }, 401);
    }

    rateLimiter.reset(username);
    const token = generateToken(username, authConfig);

    return c.json({
      data: {
        token,
        expiresIn: authConfig.tokenExpiry,
      },
    });
  });
}
