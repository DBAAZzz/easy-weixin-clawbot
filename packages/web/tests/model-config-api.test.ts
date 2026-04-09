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
