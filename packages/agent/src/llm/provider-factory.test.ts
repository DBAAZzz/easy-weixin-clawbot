import test from "node:test";
import assert from "node:assert/strict";
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
