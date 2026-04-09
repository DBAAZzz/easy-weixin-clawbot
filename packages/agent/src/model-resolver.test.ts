import assert from "node:assert/strict";
import test from "node:test";
import { invalidateModelCache, resolveModel } from "./model-resolver.js";
import {
  setModelConfigStore,
  type ModelConfigStore,
} from "./ports/model-config-store.js";

function makeStore(): ModelConfigStore {
  return {
    async listTemplates() {
      return [];
    },
    async createTemplate() {
      throw new Error("not implemented");
    },
    async updateTemplate() {
      throw new Error("not implemented");
    },
    async deleteTemplate() {
      return false;
    },
    async getTemplateById() {
      return null;
    },
    async countConfigsForTemplate() {
      return 0;
    },
    async listAllConfigs() {
      return [];
    },
    async upsertConfig() {
      throw new Error("not implemented");
    },
    async deleteConfig() {
      return false;
    },
    async findByScope(scope, scopeKey) {
      if (scope === "global" && scopeKey === "*") {
        return [
          {
            id: 1n,
            scope: "global",
            scopeKey: "*",
            purpose: "chat",
            templateId: 5n,
            templateName: "Moonshot Main",
            provider: "moonshot",
            modelId: "moonshot-v1-8k",
            modelIds: ["moonshot-v1-8k", "moonshot-v1-32k"],
            apiKey: "sk-test",
            baseUrl: "https://api.moonshot.cn/v1",
            templateEnabled: true,
            enabled: true,
            priority: 0,
          },
        ];
      }
      return [];
    },
  };
}

test("resolveModel uses template-backed config data", async () => {
  setModelConfigStore(makeStore());
  invalidateModelCache();

  const resolved = await resolveModel("wxid_1", "conv_1", "chat");

  assert.equal(resolved.modelId, "moonshot-v1-8k");
  assert.equal(resolved.apiKey, "sk-test");
});

test("resolveModel skips disabled templates and falls back", async () => {
  let calls = 0;
  setModelConfigStore({
    ...makeStore(),
    async findByScope(scope, scopeKey) {
      calls += 1;
      if (scope === "global" && scopeKey === "*") {
        return [
          {
            id: 2n,
            scope: "global",
            scopeKey: "*",
            purpose: "chat",
            templateId: 6n,
            templateName: "Disabled OpenAI",
            provider: "openai",
            modelId: "gpt-5",
            modelIds: ["gpt-5"],
            apiKey: "sk-test",
            baseUrl: null,
            templateEnabled: false,
            enabled: true,
            priority: 0,
          },
        ];
      }
      return [];
    },
  });
  invalidateModelCache();

  await assert.rejects(
    () => resolveModel("wxid_1", "conv_1", "chat"),
    /Default model not set/,
  );
  assert.ok(calls > 0);
});
