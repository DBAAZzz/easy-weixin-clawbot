import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { createModuleLogger } from "../logger.js";

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
  tokenExpiry: string;
}

const authLogger = createModuleLogger("auth");

export function loadAuthConfig(): AuthConfig | undefined {
  const configPath = resolve(process.cwd(), "config.yaml");

  if (!existsSync(configPath)) {
    authLogger.error(
      { configPath },
      "未找到 config.yaml，已关闭鉴权",
    );
    return undefined;
  }

  const content = readFileSync(configPath, "utf-8");
  const config = yaml.load(content) as { auth?: AuthConfig };

  if (!config.auth) {
    authLogger.warn("config.yaml 缺少 auth 配置，已关闭鉴权");
    return undefined;
  }

  return config.auth;
}
