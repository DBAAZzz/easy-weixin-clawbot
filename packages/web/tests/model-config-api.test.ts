import assert from "node:assert/strict";
import test from "node:test";

const originalFetch = globalThis.fetch;
const originalWindow = (globalThis as typeof globalThis & { window?: Window }).window;
const originalLocalStorage = (globalThis as typeof globalThis & { localStorage?: Storage })
  .localStorage;

function installBrowserMocks(handler: typeof fetch) {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage = {
    getItem: () => "token",
    removeItem: () => {},
    setItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage;
  (globalThis as typeof globalThis & { window: Window & typeof globalThis }).window = {
    location: { href: "" },
  } as Window & typeof globalThis;
  globalThis.fetch = handler;
}

test("createModelProviderTemplate posts template payload", async () => {
  let requestInit: RequestInit | undefined;
  installBrowserMocks(async (_input, init) => {
    requestInit = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "1",
          name: "OpenAI Main",
          provider: "openai",
          model_ids: ["gpt-5", "gpt-5-mini"],
          api_key_set: true,
          base_url: null,
          enabled: true,
          usage_count: 0,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const { createModelProviderTemplate } = await import("../src/lib/api.ts");

  await createModelProviderTemplate({
    name: "OpenAI Main",
    provider: "openai",
    model_ids: ["gpt-5", "gpt-5-mini"],
    api_key: "sk-test",
    base_url: null,
    enabled: true,
  });

  assert.equal(requestInit?.method, "POST");
  assert.match(String(requestInit?.body), /"provider":"openai"/);
  assert.match(String(requestInit?.body), /"model_ids":\["gpt-5","gpt-5-mini"\]/);
});

test("upsertModelConfig sends template_id instead of provider credentials", async () => {
  let requestInit: RequestInit | undefined;
  installBrowserMocks(async (_input, init) => {
    requestInit = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "10",
          scope: "global",
          scope_key: "*",
          purpose: "chat",
          template_id: "1",
          template_name: "OpenAI Main",
          provider: "openai",
          model_id: "gpt-5",
          template_enabled: true,
          enabled: true,
          priority: 0,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const { upsertModelConfig } = await import("../src/lib/api.ts");

  await upsertModelConfig({
    scope: "global",
    scope_key: "*",
    purpose: "chat",
    template_id: "1",
    model_id: "gpt-5",
    enabled: true,
    priority: 0,
  });

  assert.doesNotMatch(String(requestInit?.body), /provider|api_key|base_url/);
  assert.match(String(requestInit?.body), /"template_id":"1"/);
  assert.match(String(requestInit?.body), /"model_id":"gpt-5"/);
});

test("pingModelProviderTemplate posts ping request", async () => {
  let requestInit: RequestInit | undefined;
  let requestPath = "";
  installBrowserMocks(async (input, init) => {
    requestPath = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        data: {
          template_id: "12",
          provider: "deepseek",
          reachable: true,
          status_code: 200,
          latency_ms: 123,
          checked_at: "2026-04-11T12:00:00.000Z",
          endpoint: "https://api.deepseek.com/v1/models",
          message: "连接正常",
          model_count: 2,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const { pingModelProviderTemplate } = await import("../src/lib/api.ts");

  await pingModelProviderTemplate("12");

  assert.equal(requestPath, "/api/model-provider-templates/12/ping");
  assert.equal(requestInit?.method, "POST");
});

test.after(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
  } else {
    delete (globalThis as typeof globalThis & { window?: Window }).window;
  }
  if (originalLocalStorage) {
    (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage =
      originalLocalStorage;
  } else {
    delete (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  }
});
