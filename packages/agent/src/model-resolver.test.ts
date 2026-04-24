import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidateModelCache,
  LLMProviderNotConfiguredError,
  resolveModel,
} from "./model-resolver.js";
import {
  setModelConfigStore,
  type ModelConfigRow,
  type ModelConfigStore,
  type ModelScope,
} from "./ports/index.js";

function createRow(overrides: Partial<ModelConfigRow> = {}): ModelConfigRow {
  return {
    id: 1n,
    scope: "global",
    scopeKey: "*",
    purpose: "chat",
    templateId: 1n,
    templateName: "default-template",
    provider: "openai",
    modelId: "gpt-5",
    modelIds: ["gpt-5"],
    apiKey: "db-key",
    baseUrl: null,
    templateEnabled: true,
    enabled: true,
    priority: 0,
    ...overrides,
  };
}

function createStore(
  rowsByScope: Record<string, ModelConfigRow[]>,
): ModelConfigStore {
  async function unsupported(): Promise<never> {
    throw new Error("not implemented in test");
  }

  return {
    async findByScope(scope: ModelScope, scopeKey: string) {
      return rowsByScope[`${scope}:${scopeKey}`] ?? [];
    },
    listTemplates: unsupported,
    createTemplate: unsupported,
    updateTemplate: unsupported,
    deleteTemplate: unsupported,
    getTemplateById: unsupported,
    countConfigsForTemplate: unsupported,
    listAllConfigs: unsupported,
    upsertConfig: unsupported,
    deleteConfig: unsupported,
  };
}

function applyStore(rowsByScope: Record<string, ModelConfigRow[]>): void {
  invalidateModelCache();
  setModelConfigStore(createStore(rowsByScope));
}

test.afterEach(() => {
  invalidateModelCache();
});

test("global database config resolves without any LLM env vars", async () => {
  applyStore({
    "global:*": [
      createRow({
        scope: "global",
        scopeKey: "*",
        provider: "openai",
        modelId: "gpt-5",
        modelIds: ["gpt-5"],
      }),
    ],
  });

  const resolved = await resolveModel("acct-1", "conv-1", "chat");

  assert.equal(resolved.modelId, "gpt-5");
  assert.equal((resolved.model as { provider?: string }).provider, "openai.responses");
});

test("conversation config overrides account and global", async () => {
  applyStore({
    "conversation:acct-1:conv-1": [
      createRow({
        id: 3n,
        scope: "conversation",
        scopeKey: "acct-1:conv-1",
        modelId: "gpt-5",
      }),
    ],
    "account:acct-1": [
      createRow({
        id: 2n,
        scope: "account",
        scopeKey: "acct-1",
        modelId: "gpt-5-mini",
        modelIds: ["gpt-5-mini"],
      }),
    ],
    "global:*": [
      createRow({
        id: 1n,
        scope: "global",
        scopeKey: "*",
        modelId: "gpt-4.1-mini",
        modelIds: ["gpt-4.1-mini"],
      }),
    ],
  });

  const resolved = await resolveModel("acct-1", "conv-1", "chat");

  assert.equal(resolved.modelId, "gpt-5");
});

test("account config overrides global", async () => {
  applyStore({
    "account:acct-1": [
      createRow({
        id: 2n,
        scope: "account",
        scopeKey: "acct-1",
        modelId: "gpt-5-mini",
        modelIds: ["gpt-5-mini"],
      }),
    ],
    "global:*": [
      createRow({
        id: 1n,
        scope: "global",
        scopeKey: "*",
        modelId: "gpt-4.1-mini",
        modelIds: ["gpt-4.1-mini"],
      }),
    ],
  });

  const resolved = await resolveModel("acct-1", "conv-1", "chat");

  assert.equal(resolved.modelId, "gpt-5-mini");
});

test("missing database config throws LLM_PROVIDER_NOT_CONFIGURED", async () => {
  applyStore({});

  await assert.rejects(
    () => resolveModel("acct-1", "conv-1", "chat"),
    (error: unknown) => {
      assert.ok(error instanceof LLMProviderNotConfiguredError);
      assert.equal(error.code, "LLM_PROVIDER_NOT_CONFIGURED");
      assert.equal(error.accountId, "acct-1");
      assert.equal(error.conversationId, "conv-1");
      assert.equal(error.purpose, "chat");
      return true;
    },
  );
});

test("disabled template is skipped in favor of the next candidate", async () => {
  applyStore({
    "global:*": [
      createRow({
        id: 1n,
        templateEnabled: false,
        modelId: "gpt-4.1-mini",
        modelIds: ["gpt-4.1-mini"],
      }),
      createRow({
        id: 2n,
        modelId: "gpt-5",
        modelIds: ["gpt-5"],
      }),
    ],
  });

  const resolved = await resolveModel("acct-1", "conv-1", "chat");

  assert.equal(resolved.modelId, "gpt-5");
});

test("invalid model_id outside template model list is skipped", async () => {
  applyStore({
    "global:*": [
      createRow({
        id: 1n,
        modelId: "gpt-5",
        modelIds: ["gpt-4.1-mini"],
      }),
      createRow({
        id: 2n,
        modelId: "gpt-5-mini",
        modelIds: ["gpt-5-mini"],
      }),
    ],
  });

  const resolved = await resolveModel("acct-1", "conv-1", "chat");

  assert.equal(resolved.modelId, "gpt-5-mini");
});