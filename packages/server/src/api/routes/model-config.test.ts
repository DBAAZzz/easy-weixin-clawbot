import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ModelConfigStore } from "@clawbot/agent";
import { setModelConfigStore } from "@clawbot/agent";
import { registerModelConfigRoutes } from "./model-config.js";

function createStoreStub(): ModelConfigStore {
  return {
    async findByScope() {
      return [];
    },
    async listTemplates() {
      return [
        {
          id: 1n,
          name: "OpenAI Main",
          provider: "openai",
          modelIds: ["gpt-5", "gpt-5-mini"],
          apiKey: "sk-test",
          baseUrl: null,
          enabled: true,
          usageCount: 0,
        },
      ];
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
    async getTemplateById(id) {
      return id === 1n
        ? {
            id: 1n,
            name: "OpenAI Main",
            provider: "openai",
            modelIds: ["gpt-5", "gpt-5-mini"],
            apiKey: "sk-test",
            baseUrl: null,
            enabled: true,
            usageCount: 0,
          }
        : null;
    },
    async countConfigsForTemplate() {
      return 0;
    },
    async listAllConfigs() {
      return [];
    },
    async upsertConfig() {
      throw new Error("should not be called");
    },
    async deleteConfig() {
      return false;
    },
  };
}

test("PUT /api/model-configs rejects model outside template list", async () => {
  setModelConfigStore(createStoreStub());
  const app = new Hono();
  registerModelConfigRoutes(app);

  const response = await app.request("/api/model-configs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "global",
      scope_key: "*",
      purpose: "chat",
      template_id: "1",
      model_id: "not-allowed",
    }),
  });

  assert.equal(response.status, 400);
  assert.match(await response.text(), /model_id must belong/i);
});
