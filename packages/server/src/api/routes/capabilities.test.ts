import test from "node:test";
import assert from "node:assert/strict";
import type { SkillInstaller, ToolInstaller } from "@clawbot/agent";
import { createApiApp } from "../index.js";

function createToolInstallerStub(): ToolInstaller {
  return {
    async initialize() {
      return { loaded: [], failed: [] };
    },
    list() {
      return [
        {
          name: "web_search",
          summary: "搜索互联网，返回标题、链接和摘要",
          version: "1.0.0",
          type: "tool" as const,
          handler: "web-search",
          origin: "builtin" as const,
          enabled: true,
          parameterNames: ["maxResults", "query"],
          installedAt: "2026-03-27T00:00:00.000Z",
          filePath: "/tmp/web-search.md",
        },
      ];
    },
    get(name) {
      return this.list().find((item) => item.name === name) ?? null;
    },
    async getSource() {
      return "---\nname: web_search\n---\n";
    },
    async validate() {
      return this.list()[0];
    },
    async install() {
      return this.list()[0];
    },
    async update() {
      return this.list()[0];
    },
    async remove() {},
    async enable() {
      return this.list()[0];
    },
    async disable() {
      return this.list()[0];
    },
  };
}

function createSkillInstallerStub(): SkillInstaller {
  return {
    async initialize() {
      return { loaded: [], failed: [] };
    },
    list() {
      return [
        {
          name: "translator",
          summary: "翻译文本到指定语言",
          version: "1.0.0",
          type: "skill" as const,
          activation: "on-demand" as const,
          origin: "user" as const,
          enabled: true,
          installedAt: "2026-03-27T00:00:00.000Z",
          filePath: "/tmp/translator.md",
        },
      ];
    },
    get(name) {
      return this.list().find((item) => item.name === name) ?? null;
    },
    async getSource() {
      return "---\nname: translator\n---\n";
    },
    async validate() {
      return this.list()[0];
    },
    async install() {
      return this.list()[0];
    },
    async update() {
      return this.list()[0];
    },
    async remove() {},
    async enable() {
      return this.list()[0];
    },
    async disable() {
      return this.list()[0];
    },
  };
}

test("capability routes expose tools, skills, and legacy tool compatibility", async () => {
  process.env.API_SECRET = "test-secret";

  const app = createApiApp({
    runtime: {} as never,
    loginManager: {} as never,
    toolInstaller: createToolInstallerStub(),
    skillInstaller: createSkillInstallerStub(),
    mcpManager: {} as never,
    startedAt: new Date("2026-03-27T00:00:00.000Z"),
  });

  const headers = { Authorization: "Bearer test-secret" };

  const toolsResponse = await app.request("/api/tools", { headers });
  const skillsResponse = await app.request("/api/skills", { headers });
  const legacyResponse = await app.request("/api/legacy/skills", { headers });

  assert.equal(toolsResponse.status, 200);
  assert.equal(skillsResponse.status, 200);
  assert.equal(legacyResponse.status, 200);

  const toolsPayload = (await toolsResponse.json()) as { data: Array<{ name: string }> };
  const skillsPayload = (await skillsResponse.json()) as { data: Array<{ name: string }> };
  const legacyPayload = (await legacyResponse.json()) as { data: Array<{ id: string }> };

  assert.deepEqual(toolsPayload.data.map((item) => item.name), ["web_search"]);
  assert.deepEqual(skillsPayload.data.map((item) => item.name), ["translator"]);
  assert.deepEqual(legacyPayload.data.map((item) => item.id), ["web_search"]);
});
