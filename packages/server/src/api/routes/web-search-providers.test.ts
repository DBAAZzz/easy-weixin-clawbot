import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { registerWebSearchProviderRoutes } from "./web-search-providers.js";
import type {
  CreateWebSearchProviderInput,
  UpdateWebSearchProviderInput,
  WebSearchProviderRow,
  WebSearchProviderStore,
} from "../../web-tools/provider-store.js";
import type { WebSearchProviderType } from "../../web-tools/provider-types.js";

function createRow(
  providerType: WebSearchProviderType,
  overrides: Partial<WebSearchProviderRow> = {},
): WebSearchProviderRow {
  return {
    id: providerType === "brave" ? 1n : 2n,
    providerType,
    apiKeySet: true,
    enabled: true,
    createdAt: new Date("2026-04-21T00:00:00.000Z"),
    updatedAt: new Date("2026-04-21T00:00:00.000Z"),
    ...overrides,
  };
}

function createStore(initialRows: WebSearchProviderRow[] = []): WebSearchProviderStore {
  const rows = new Map(initialRows.map((row) => [row.providerType, row]));

  return {
    async list() {
      return [...rows.values()].sort((left, right) => left.providerType.localeCompare(right.providerType));
    },
    async get(providerType) {
      return rows.get(providerType) ?? null;
    },
    async create(input: CreateWebSearchProviderInput) {
      const row = createRow(input.providerType, {
        enabled: input.enabled ?? true,
        updatedAt: new Date("2026-04-21T00:00:00.000Z"),
      });
      rows.set(input.providerType, row);
      return row;
    },
    async update(providerType: WebSearchProviderType, input: UpdateWebSearchProviderInput) {
      const existing = rows.get(providerType);
      if (!existing) {
        throw new Error("provider not found");
      }
      const updated = {
        ...existing,
        enabled: input.enabled ?? existing.enabled,
        apiKeySet: input.apiKey === undefined ? existing.apiKeySet : true,
        updatedAt: new Date("2026-04-22T00:00:00.000Z"),
      };
      rows.set(providerType, updated);
      return updated;
    },
    async enable(providerType) {
      return this.update(providerType, { enabled: true });
    },
    async disable(providerType) {
      return this.update(providerType, { enabled: false });
    },
    async listEnabledWithApiKeys() {
      return [];
    },
  };
}

function createApp(store: WebSearchProviderStore) {
  const app = new Hono();
  registerWebSearchProviderRoutes(app, store);
  return app;
}

test("creates a web search provider config", async () => {
  const app = createApp(createStore());

  const response = await app.request("/api/web-search/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider_type: "brave",
      api_key: "brave-key",
      enabled: false,
    }),
  });
  const payload = (await response.json()) as {
    data: {
      provider_type: string;
      api_key_set: boolean;
      enabled: boolean;
    };
  };

  assert.equal(response.status, 201);
  assert.equal(payload.data.provider_type, "brave");
  assert.equal(payload.data.api_key_set, true);
  assert.equal(payload.data.enabled, false);
});

test("rejects unsupported provider types", async () => {
  const app = createApp(createStore());

  const response = await app.request("/api/web-search/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider_type: "duckduckgo",
      api_key: "ddg-key",
    }),
  });
  const payload = (await response.json()) as { error: string };

  assert.equal(response.status, 400);
  assert.equal(payload.error, "provider_type must be brave or tavily");
});

test("updates and toggles provider config", async () => {
  const app = createApp(createStore([createRow("tavily", { enabled: false })]));

  const updateResponse = await app.request("/api/web-search/providers/tavily", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  const updatePayload = (await updateResponse.json()) as {
    data: { enabled: boolean };
  };

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.data.enabled, true);

  const disableResponse = await app.request("/api/web-search/providers/tavily/disable", {
    method: "POST",
  });
  const disablePayload = (await disableResponse.json()) as {
    data: { enabled: boolean };
  };

  assert.equal(disableResponse.status, 200);
  assert.equal(disablePayload.data.enabled, false);
});