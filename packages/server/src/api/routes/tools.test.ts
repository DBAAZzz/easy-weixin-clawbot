import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { registerToolRoutes } from "./tools.js";

function createApp() {
  const app = new Hono();
  registerToolRoutes(app);
  return app;
}

test("lists code-defined builtin tool metadata", async () => {
  const app = createApp();

  const response = await app.request("/api/tools");
  const payload = (await response.json()) as {
    data: Array<{ name: string; origin: string; managedBySystem: boolean }>;
  };

  assert.equal(response.status, 200);
  assert.ok(payload.data.some((tool) => tool.name === "web_search"));
  assert.ok(payload.data.every((tool) => tool.origin === "builtin"));
  assert.ok(payload.data.every((tool) => tool.managedBySystem === true));
});

test("returns one builtin tool by name", async () => {
  const app = createApp();

  const response = await app.request("/api/tools/web_search");
  const payload = (await response.json()) as {
    data: { name: string; parameterNames: string[] };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.data.name, "web_search");
  assert.deepEqual(payload.data.parameterNames, ["maxResults", "query"]);
});

test("returns 404 for unknown tool", async () => {
  const app = createApp();

  const response = await app.request("/api/tools/missing_tool");
  const payload = (await response.json()) as { error: string };

  assert.equal(response.status, 404);
  assert.equal(payload.error, "tool not found");
});
