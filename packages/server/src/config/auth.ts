import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

export interface AuthConfig {
  username: string;
  password: string;
  jwtSecret: string;
  tokenExpiry: string;
}

export function loadAuthConfig(): AuthConfig {
  const configPath = resolve(process.cwd(), "config.yaml");
  const content = readFileSync(configPath, "utf-8");
  const config = yaml.load(content) as { auth: AuthConfig };

  if (!config.auth) {
    throw new Error("Missing auth configuration in config.yaml");
  }

  return config.auth;
}
