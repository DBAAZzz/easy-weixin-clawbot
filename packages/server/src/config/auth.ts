import "./load-env.js";
import { createModuleLogger } from "../logger.js";

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
  tokenExpiry: string;
}

const authLogger = createModuleLogger("auth");
let authConfigLoaded = false;
let cachedAuthConfig: AuthConfig | undefined;

const MIN_JWT_SECRET_LENGTH = 32;

// Placeholders shipped in .env.example. Treated as "unset" so copying the
// example file without editing it cannot produce a forgeable admin token.
const PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-random-secret-key",
  "change-me",
  "secret",
  "changeme",
]);

const GENERATE_SECRET_HINT =
  'Generate one with: node -p "require(\'crypto\').randomBytes(32).toString(\'hex\')"';

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function assertUsableSecret(jwtSecret: string): void {
  if (PLACEHOLDER_SECRETS.has(jwtSecret.toLowerCase())) {
    throw new Error(
      "AUTH_JWT_SECRET is still set to the .env.example placeholder. " +
        "Anyone can forge an admin token with a publicly known secret. " +
        GENERATE_SECRET_HINT,
    );
  }

  if (isProduction() && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `AUTH_JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters in production. ` +
        GENERATE_SECRET_HINT,
    );
  }
}

export function resetAuthConfigCacheForTests(): void {
  authConfigLoaded = false;
  cachedAuthConfig = undefined;
}

/**
 * Resolve the admin auth config from environment.
 *
 * Fails closed: a partial or production-missing configuration throws instead of
 * silently disabling authentication for the whole API. Returning `undefined` is
 * reserved for the single explicit case of a non-production run with no auth
 * env vars set at all.
 */
export function loadAuthConfig(): AuthConfig | undefined {
  if (authConfigLoaded) {
    return cachedAuthConfig;
  }

  const username = process.env.AUTH_USERNAME?.trim();
  const password = process.env.AUTH_PASSWORD;
  const jwtSecret = process.env.AUTH_JWT_SECRET?.trim();
  const tokenExpiry = process.env.AUTH_TOKEN_EXPIRY?.trim() || "24h";

  const provided = [username, password, jwtSecret].filter(Boolean).length;

  if (provided === 0) {
    if (isProduction()) {
      throw new Error(
        "AUTH_USERNAME / AUTH_PASSWORD / AUTH_JWT_SECRET are required in production. " +
          "Refusing to start an unauthenticated API. " +
          GENERATE_SECRET_HINT,
      );
    }

    authLogger.warn(
      "未配置 AUTH_USERNAME / AUTH_PASSWORD / AUTH_JWT_SECRET，本次以无鉴权模式启动（仅限开发环境）",
    );
    authConfigLoaded = true;
    return undefined;
  }

  // A partial config is always a misconfiguration — a typo in one variable must
  // never silently open the entire API.
  if (!username || !password || !jwtSecret) {
    const missing = [
      username ? null : "AUTH_USERNAME",
      password ? null : "AUTH_PASSWORD",
      jwtSecret ? null : "AUTH_JWT_SECRET",
    ].filter(Boolean);

    throw new Error(
      `Incomplete auth configuration; missing ${missing.join(", ")}. ` +
        "Set all three to enable authentication, or unset all three to run without auth in development.",
    );
  }

  assertUsableSecret(jwtSecret);

  cachedAuthConfig = { username, password, jwtSecret, tokenExpiry };
  authConfigLoaded = true;

  return cachedAuthConfig;
}
