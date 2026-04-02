import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
  tokenExpiry: string;
}

export function loadAuthConfig(): AuthConfig | undefined {
  const configPath = resolve(process.cwd(), "config.yaml");

  if (!existsSync(configPath)) {
    console.error(`[auth] config.yaml not found at ${configPath}, authentication disabled.`);
    return undefined;
  }

  const content = readFileSync(configPath, "utf-8");
  const config = yaml.load(content) as { auth?: AuthConfig };

  if (!config.auth) {
    console.warn("[auth] Missing auth section in config.yaml, authentication disabled.");
    return undefined;
  }

  return config.auth;
}
