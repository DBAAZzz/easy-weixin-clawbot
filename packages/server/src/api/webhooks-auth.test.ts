import assert from "node:assert/strict";
import test from "node:test";
import type { ApiDependencies } from "./index.js";

function createDeps(): ApiDependencies {
  return {
    runtime: {
      async bootstrap() {},
      ensureAccountStarted() {},
      getRunningAccountIds: () => [],
      getUptimeMs: () => 0,
      async shutdown() {},
    },
    loginManager: {
      async start() {
        return { status: "idle" };
      },
      getState() {
        return { status: "idle" };
      },
      cancel() {
        return { status: "idle" };
      },
    },
    skillInstaller: {
      list: async () => [],
      get: async () => null,
      install: async () => {
        throw new Error("not implemented");
      },
      update: async () => {
        throw new Error("not implemented");
      },
      remove: async () => false,
    },
    mcpManager: {
      bootstrap: async () => {},
      shutdown: async () => {},
      refreshServer: async () => {},
      removeServer: async () => {},
      getAllStatuses: () => [],
      getStatus: () => undefined,
    },
    startedAt: new Date("2026-07-02T00:00:00.000Z"),
  } as unknown as ApiDependencies;
}

test("webhook token management routes require JWT auth", async () => {
  process.env.AUTH_USERNAME = "admin";
  process.env.AUTH_PASSWORD = "password";
  process.env.AUTH_JWT_SECRET = "test-secret";

  const { createApiApp } = await import("./index.js");
  const app = createApiApp(createDeps());

  const response = await app.request("/api/webhooks/tokens");
  const payload = (await response.json()) as { error: string };

  assert.equal(response.status, 401);
  assert.equal(payload.error, "Missing or invalid Authorization header");
});
