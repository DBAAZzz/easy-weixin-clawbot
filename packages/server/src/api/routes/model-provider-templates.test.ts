import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ModelConfigStore } from "@clawbot/agent";
import { setModelConfigStore } from "@clawbot/agent";
import { registerModelProviderTemplateRoutes } from "./model-provider-templates.js";

function createStoreStub(): ModelConfigStore {
  return {
    async findByScope() {
      return [];
    },
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
  };
}

test("POST /api/model-provider-templates rejects empty model_ids", async () => {
  setModelConfigStore(createStoreStub());
  const app = new Hono();
  registerModelProviderTemplateRoutes(app);

  const response = await app.request("/api/model-provider-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "OpenAI Main",
      provider: "openai",
      model_ids: [],
    }),
  });

  assert.equal(response.status, 400);
  assert.match(await response.text(), /model_ids/i);
});
