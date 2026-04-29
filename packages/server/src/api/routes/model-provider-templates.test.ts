import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type {
  ModelConfigRow,
  ModelConfigStore,
  ModelProviderTemplateRow,
  UpsertModelConfigInput,
  UpdateModelProviderTemplateInput,
} from "@clawbot/agent";
import { setModelConfigStore } from "@clawbot/agent";
import { registerModelProviderTemplateRoutes } from "./model-provider-templates.js";

const originalFetch = globalThis.fetch;

function createTemplate(
  overrides: Partial<ModelProviderTemplateRow> = {},
): ModelProviderTemplateRow {
  return {
    id: 1n,
    name: "DeepSeek Main",
    provider: "deepseek",
    modelIds: ["deepseek-chat"],
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com/v1",
    enabled: true,
    usageCount: 0,
    ...overrides,
  };
}

function createStore(template: ModelProviderTemplateRow): ModelConfigStore {
  return {
    findByScope: async () => [],
    listTemplates: async () => [template],
    createTemplate: async () => template,
    updateTemplate: async (input: UpdateModelProviderTemplateInput) => ({
      ...template,
      id: input.id,
      name: input.name,
      provider: input.provider,
      modelIds: input.modelIds,
      apiKey:
        input.clearApiKey === true
          ? null
          : input.apiKey === undefined
            ? template.apiKey
            : input.apiKey,
      baseUrl: input.baseUrl ?? null,
      enabled: input.enabled ?? true,
    }),
    deleteTemplate: async () => true,
    getTemplateById: async (id: bigint) => (id === template.id ? template : null),
    countConfigsForTemplate: async () => 0,
    listAllConfigs: async () => [],
    upsertConfig: async (_input: UpsertModelConfigInput): Promise<ModelConfigRow> => {
      throw new Error("not implemented");
    },
    deleteConfig: async () => true,
  };
}

function createAppWithTemplate(template: ModelProviderTemplateRow) {
  setModelConfigStore(createStore(template));
  const app = new Hono();
  registerModelProviderTemplateRoutes(app);
  return app;
}

test("provider ping probes OpenAI-compatible /models endpoint", async () => {
  const template = createTemplate();
  const app = createAppWithTemplate(template);
  let upstreamUrl = "";
  let upstreamAuth = "";

  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamAuth = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(
      JSON.stringify({
        data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const response = await app.request("/api/model-provider-templates/1/ping", {
    method: "POST",
  });
  const payload = (await response.json()) as {
    data: {
      reachable: boolean;
      endpoint: string;
      model_count: number | null;
      message: string;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://api.deepseek.com/v1/models");
  assert.equal(upstreamAuth, "Bearer sk-test");
  assert.equal(payload.data.reachable, true);
  assert.equal(payload.data.endpoint, "https://api.deepseek.com/v1/models");
  assert.equal(payload.data.model_count, 2);
  assert.equal(payload.data.message, "连接正常");
});

test("provider ping reports missing api key without probing upstream", async () => {
  const template = createTemplate({
    provider: "openai",
    apiKey: null,
    baseUrl: null,
  });
  const app = createAppWithTemplate(template);
  let fetchCalled = false;

  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("should not be called");
  };

  const response = await app.request("/api/model-provider-templates/1/ping", {
    method: "POST",
  });
  const payload = (await response.json()) as {
    data: {
      reachable: boolean;
      endpoint: string | null;
      message: string;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(fetchCalled, false);
  assert.equal(payload.data.reachable, false);
  assert.equal(payload.data.endpoint, "https://api.openai.com/v1/models");
  assert.equal(payload.data.message, "未配置 API Key");
});

test("provider ping uses Xiaomi OpenAI-compatible default base url", async () => {
  const template = createTemplate({
    provider: "xiaomi",
    baseUrl: null,
  });
  const app = createAppWithTemplate(template);
  let upstreamUrl = "";

  globalThis.fetch = async (input) => {
    upstreamUrl = String(input);
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await app.request("/api/model-provider-templates/1/ping", {
    method: "POST",
  });
  const payload = (await response.json()) as {
    data: {
      endpoint: string;
      reachable: boolean;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://token-plan-cn.xiaomimimo.com/v1/models");
  assert.equal(payload.data.endpoint, "https://token-plan-cn.xiaomimimo.com/v1/models");
  assert.equal(payload.data.reachable, true);
});

test("provider ping uses Xiaomi Anthropic-compatible default base url", async () => {
  const template = createTemplate({
    provider: "xiaomi-anthropic",
    baseUrl: null,
  });
  const app = createAppWithTemplate(template);
  let upstreamUrl = "";
  let upstreamAnthropicVersion = "";

  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamAnthropicVersion = new Headers(init?.headers).get("anthropic-version") ?? "";
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const response = await app.request("/api/model-provider-templates/1/ping", {
    method: "POST",
  });
  const payload = (await response.json()) as {
    data: {
      endpoint: string;
      reachable: boolean;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(upstreamUrl, "https://token-plan-cn.xiaomimimo.com/anthropic/models");
  assert.equal(upstreamAnthropicVersion, "2023-06-01");
  assert.equal(payload.data.endpoint, "https://token-plan-cn.xiaomimimo.com/anthropic/models");
  assert.equal(payload.data.reachable, true);
});

test.after(() => {
  globalThis.fetch = originalFetch;
});
