import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { registerSettingsRoutes } from "./settings.js";
import {
  AppSettingsValidationError,
  type AppSettingsService,
} from "../../settings/service.js";
import type { AppSettingsRow } from "../../db/app-settings-store.js";

function createRow(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  return {
    id: 1,
    normalRate: 0.1,
    rsshubBaseUrl: null,
    rsshubAuthType: "none",
    rsshubUsername: null,
    rsshubPassword: null,
    rsshubBearerToken: null,
    rssRequestTimeoutMs: 15000,
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    ...overrides,
  };
}

function createService(initialRow: AppSettingsRow = createRow()): AppSettingsService {
  let row = initialRow;

  return {
    async get() {
      return row;
    },

    async update(payload) {
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload) ||
        Object.keys(payload).length === 0
      ) {
        throw new AppSettingsValidationError("at least one supported field is required");
      }

      const data = payload as {
        normal_rate?: unknown;
        rsshub_base_url?: unknown;
        rsshub_auth_type?: unknown;
        rss_request_timeout_ms?: unknown;
      };
      if (typeof data.normal_rate === "number") {
        row = createRow({
          ...row,
          normalRate: data.normal_rate,
          updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        });
        return row;
      }

      if (
        typeof data.rsshub_base_url === "string" ||
        typeof data.rsshub_auth_type === "string" ||
        typeof data.rss_request_timeout_ms === "number"
      ) {
        row = createRow({
          ...row,
          rsshubBaseUrl:
            typeof data.rsshub_base_url === "string" ? data.rsshub_base_url : row.rsshubBaseUrl,
          rsshubAuthType:
            data.rsshub_auth_type === "basic" ||
            data.rsshub_auth_type === "bearer" ||
            data.rsshub_auth_type === "none"
              ? data.rsshub_auth_type
              : row.rsshubAuthType,
          rssRequestTimeoutMs:
            typeof data.rss_request_timeout_ms === "number"
              ? data.rss_request_timeout_ms
              : row.rssRequestTimeoutMs,
          updatedAt: new Date("2026-04-23T00:00:00.000Z"),
        });
        return row;
      }

      throw new AppSettingsValidationError("normal_rate must be a finite number");
    },

    async bootstrap() {},
  };
}

function createApp(service: AppSettingsService) {
  const app = new Hono();
  registerSettingsRoutes(app, service);
  app.onError((error, c) => {
    return c.json({ error: error instanceof Error ? error.message : "internal error" }, 500);
  });
  return app;
}

test("gets app settings", async () => {
  const app = createApp(createService(createRow({ normalRate: 0.25 })));

  const response = await app.request("/api/settings");
  const payload = (await response.json()) as {
    data: {
      normal_rate: number;
      rsshub_base_url: string | null;
      rsshub_auth_type: string;
      rss_request_timeout_ms: number;
      updated_at: string;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.data.normal_rate, 0.25);
  assert.equal(payload.data.rsshub_base_url, null);
  assert.equal(payload.data.rsshub_auth_type, "none");
  assert.equal(payload.data.rss_request_timeout_ms, 15000);
  assert.equal(payload.data.updated_at, "2026-04-22T00:00:00.000Z");
});

test("patches app settings", async () => {
  const app = createApp(createService());

  const response = await app.request("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ normal_rate: 0.45 }),
  });
  const payload = (await response.json()) as {
    data: { normal_rate: number; updated_at: string };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.data.normal_rate, 0.45);
  assert.equal(payload.data.updated_at, "2026-04-23T00:00:00.000Z");
});

test("patches rss settings", async () => {
  const app = createApp(createService());

  const response = await app.request("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rsshub_base_url: "https://rsshub.example.com",
      rsshub_auth_type: "basic",
      rss_request_timeout_ms: 20000,
    }),
  });
  const payload = (await response.json()) as {
    data: {
      rsshub_base_url: string | null;
      rsshub_auth_type: string;
      rss_request_timeout_ms: number;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.data.rsshub_base_url, "https://rsshub.example.com");
  assert.equal(payload.data.rsshub_auth_type, "basic");
  assert.equal(payload.data.rss_request_timeout_ms, 20000);
});

test("returns 400 for invalid settings payload", async () => {
  const app = createApp(createService());

  const response = await app.request("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const payload = (await response.json()) as { error: string };

  assert.equal(response.status, 400);
  assert.equal(payload.error, "at least one supported field is required");
});

test("returns 500 when service update fails unexpectedly", async () => {
  const app = createApp({
    async get() {
      return createRow();
    },
    async update() {
      throw new Error("boom");
    },
    async bootstrap() {},
  });

  const response = await app.request("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ normal_rate: 0.2 }),
  });
  const payload = (await response.json()) as { error: string };

  assert.equal(response.status, 500);
  assert.equal(payload.error, "boom");
});
