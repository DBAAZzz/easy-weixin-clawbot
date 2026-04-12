import test from "node:test";
import assert from "node:assert/strict";
import { generateText } from "ai";
import { createLanguageModel } from "./provider-factory.js";

test("openai provider keeps default responses model", () => {
  const { model } = createLanguageModel("openai", "gpt-5", {
    apiKey: "test-key",
  });

  assert.equal((model as { provider?: string }).provider, "openai.responses");
});

test("deepseek provider uses official provider package", () => {
  const { model } = createLanguageModel("deepseek", "deepseek-chat", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^deepseek/);
});

test("moonshot provider uses official provider package", () => {
  const { model } = createLanguageModel("moonshot", "kimi-k2.5", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^moonshotai/);
});

test("kimi provider uses official provider package", () => {
  const { model } = createLanguageModel("kimi", "kimi-k2.5", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^moonshotai/);
});

test("xai provider uses official provider package", () => {
  const { model } = createLanguageModel("xai", "grok-3", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^xai/);
});

test("groq provider uses official provider package", () => {
  const { model } = createLanguageModel("groq", "llama-3.1-8b-instant", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^groq/);
});

test("mistral provider uses official provider package", () => {
  const { model } = createLanguageModel("mistral", "mistral-small-latest", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^mistral/);
});

test("openrouter provider uses openai-compatible provider package", () => {
  const { model } = createLanguageModel("openrouter", "deepseek/deepseek-chat", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^openrouter/);
});

test("kimi provider accepts KIMI_API_KEY env var fallback", async () => {
  const previousMoonshot = process.env.MOONSHOT_API_KEY;
  const previousKimi = process.env.KIMI_API_KEY;
  const previousFetch = globalThis.fetch;

  try {
    delete process.env.MOONSHOT_API_KEY;
    process.env.KIMI_API_KEY = "test-key-from-kimi-env";

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("network blocked for unit test");
    };

    const { model } = createLanguageModel("kimi", "kimi-k2.5");

    await assert.rejects(
      () =>
        generateText({
          model,
          messages: [{ role: "user", content: "hi" }],
        }),
      (error: unknown) => {
        const name = (error as { name?: string })?.name ?? "";
        assert.notEqual(name, "AI_LoadAPIKeyError");
        return true;
      },
    );

    assert.equal(fetchCalled, true);
  } finally {
    if (previousMoonshot === undefined) {
      delete process.env.MOONSHOT_API_KEY;
    } else {
      process.env.MOONSHOT_API_KEY = previousMoonshot;
    }

    if (previousKimi === undefined) {
      delete process.env.KIMI_API_KEY;
    } else {
      process.env.KIMI_API_KEY = previousKimi;
    }

    globalThis.fetch = previousFetch;
  }
});
