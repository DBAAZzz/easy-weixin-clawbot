import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import type { ToolCatalogItem, ToolInstaller } from "@clawbot/agent";
import { registerToolRoutes } from "./tools.js";

function createTool(overrides: Partial<ToolCatalogItem> = {}): ToolCatalogItem {
  return {
    name: "opencli",
    summary: "CLI bridge",
    version: "1.0.0",
    author: "clawbot",
    type: "tool",
    handler: "cli",
    origin: "user",
    enabled: true,
    managedBySystem: false,
    parameterNames: ["command"],
    installedAt: "2026-04-22T00:00:00.000Z",
    filePath: "/tmp/opencli.md",
    ...overrides,
  };
}

function createInstaller(tools: ToolCatalogItem[] = []): ToolInstaller {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  return {
    async initialize(_builtinDir: string, _userDir: string) {
      return { loaded: [], failed: [] };
    },
    list() {
      return [...byName.values()];
    },
    get(name) {
      return byName.get(name) ?? null;
    },
    async getSource(name: string) {
      return byName.has(name) ? "# test tool" : null;
    },
    async validate(_markdown: string) {
      return createTool();
    },
    async install(_markdown: string) {
      return createTool();
    },
    async update(_name: string, _markdown: string) {
      return createTool();
    },
    async remove(_name: string) {},
    async enable(name: string) {
      const tool = byName.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }
      return tool;
    },
    async disable(name: string) {
      if (name === "web_search") {
        throw new Error("System tool cannot be disabled: web_search");
      }
      const tool = byName.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }
      return { ...tool, enabled: false };
    },
  };
}

function createApp(installer: ToolInstaller) {
  const app = new Hono();
  registerToolRoutes(app, installer);
  return app;
}

test("lists system-managed tool metadata", async () => {
  const app = createApp(
    createInstaller([
      createTool({
        name: "web_search",
        summary: "Builtin web search",
        origin: "builtin",
        managedBySystem: true,
      }),
    ]),
  );

  const response = await app.request("/api/tools");
  const payload = (await response.json()) as {
    data: Array<{ name: string; managedBySystem: boolean }>;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.data.map(({ name, managedBySystem }) => ({ name, managedBySystem })), [
    {
      name: "web_search",
      managedBySystem: true,
    },
  ]);
});

test("rejects disabling a system-managed tool", async () => {
  const app = createApp(
    createInstaller([
      createTool({
        name: "web_search",
        summary: "Builtin web search",
        origin: "builtin",
        managedBySystem: true,
      }),
    ]),
  );

  const response = await app.request("/api/tools/web_search/disable", {
    method: "POST",
  });
  const payload = (await response.json()) as { error: string };

  assert.equal(response.status, 400);
  assert.equal(payload.error, "System tool cannot be disabled: web_search");
});
