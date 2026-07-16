import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadAuthConfig, resetAuthConfigCacheForTests } from "./auth.js";

const AUTH_VARS = [
  "AUTH_USERNAME",
  "AUTH_PASSWORD",
  "AUTH_JWT_SECRET",
  "AUTH_TOKEN_EXPIRY",
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(vars: Partial<Record<(typeof AUTH_VARS)[number] | "NODE_ENV", string>>) {
  for (const key of [...AUTH_VARS, "NODE_ENV"]) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }

  resetAuthConfigCacheForTests();
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
  resetAuthConfigCacheForTests();
});

describe("loadAuthConfig", () => {
  const strongSecret = "a".repeat(48);

  it("returns the config when fully set", () => {
    setEnv({ AUTH_USERNAME: "admin", AUTH_PASSWORD: "pw", AUTH_JWT_SECRET: strongSecret });
    const config = loadAuthConfig();
    assert.equal(config?.username, "admin");
    assert.equal(config?.tokenExpiry, "24h");
  });

  it("throws on a partial config rather than silently disabling auth", () => {
    setEnv({ AUTH_USERNAME: "admin", AUTH_JWT_SECRET: strongSecret });
    assert.throws(() => loadAuthConfig(), /Incomplete auth configuration.*AUTH_PASSWORD/s);
  });

  it("throws on a partial config even in development", () => {
    setEnv({
      NODE_ENV: "development",
      AUTH_USERNAME: "admin",
      AUTH_PASSWORD: "pw",
    });
    assert.throws(() => loadAuthConfig(), /Incomplete auth configuration.*AUTH_JWT_SECRET/s);
  });

  it("refuses to start unauthenticated in production", () => {
    setEnv({ NODE_ENV: "production" });
    assert.throws(() => loadAuthConfig(), /required in production/);
  });

  it("rejects the .env.example placeholder secret", () => {
    setEnv({
      AUTH_USERNAME: "admin",
      AUTH_PASSWORD: "pw",
      AUTH_JWT_SECRET: "change-me-to-a-random-secret-key",
    });
    assert.throws(() => loadAuthConfig(), /placeholder/);
  });

  it("rejects a short secret in production", () => {
    setEnv({
      NODE_ENV: "production",
      AUTH_USERNAME: "admin",
      AUTH_PASSWORD: "pw",
      AUTH_JWT_SECRET: "too-short",
    });
    assert.throws(() => loadAuthConfig(), /at least 32 characters/);
  });

  it("allows auth to be off in development when nothing is set", () => {
    setEnv({ NODE_ENV: "development" });
    assert.equal(loadAuthConfig(), undefined);
  });

  it("keeps throwing on repeated calls instead of caching a disabled state", () => {
    setEnv({ AUTH_USERNAME: "admin" });
    assert.throws(() => loadAuthConfig());
    assert.throws(() => loadAuthConfig());
  });
});
