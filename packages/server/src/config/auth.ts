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

export function loadAuthConfig(): AuthConfig | undefined {
  if (authConfigLoaded) {
    return cachedAuthConfig;
  }

  authConfigLoaded = true;

  const username = process.env.AUTH_USERNAME?.trim();
  const password = process.env.AUTH_PASSWORD;
  const jwtSecret = process.env.AUTH_JWT_SECRET?.trim();
  const tokenExpiry = process.env.AUTH_TOKEN_EXPIRY?.trim() || "24h";

  if (!username && !password && !jwtSecret) {
    authLogger.warn(
      "未配置 AUTH_USERNAME / AUTH_PASSWORD / AUTH_JWT_SECRET，已关闭鉴权",
    );
    return undefined;
  }

  if (!username || !password || !jwtSecret) {
    authLogger.warn(
      "AUTH_USERNAME / AUTH_PASSWORD / AUTH_JWT_SECRET 未完整配置，已关闭鉴权",
    );
    return undefined;
  }

  cachedAuthConfig = {
    username,
    password,
    jwtSecret,
    tokenExpiry,
  };

  return cachedAuthConfig;
}
