import test from "node:test";
import assert from "node:assert/strict";
import { generateText, tool } from "ai";
import { z } from "zod";
import { agentToModelMessages } from "./messages.js";
import { createLanguageModel } from "./provider-factory.js";

test("openai provider keeps default responses model", () => {
  const { model } = createLanguageModel("openai", "gpt-5", {
    apiKey: "test-key",
  });

  assert.equal((model as { provider?: string }).provider, "openai.responses");
});

test("deepseek provider uses openai-compatible chat transport", () => {
  const { model, meta } = createLanguageModel("deepseek", "deepseek-chat", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^deepseek/);
  assert.equal(meta.contextWindow, 1_000_000);
  assert.equal(meta.maxOutputTokens, 384_000);
  assert.equal(meta.supportsImageInput, false);
});

test("deepseek provider preserves historical reasoning_content after tool calls", async () => {
  const previousFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];

  try {
    globalThis.fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          created: 1,
          model: "deepseek-v4-flash",
          choices: [
            {
              message: { role: "assistant", content: "ok" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const { model } = createLanguageModel("deepseek", "deepseek-v4-flash", {
      apiKey: "test-key",
    });

    await generateText({
      model,
      messages: agentToModelMessages([
        {
          role: "user",
          timestamp: Date.now(),
          content: [{ type: "text", text: "查一下今天日期" }],
        },
        {
          role: "assistant",
          timestamp: Date.now(),
          stopReason: "toolUse",
          content: [
            { type: "thinking", thinking: "Need to call the date tool first." },
            { type: "text", text: "我先查一下日期。" },
            {
              type: "toolCall",
              id: "call_1",
              name: "get_date",
              arguments: {},
            },
          ],
        },
        {
          role: "toolResult",
          timestamp: Date.now(),
          toolCallId: "call_1",
          toolName: "get_date",
          isError: false,
          content: [{ type: "text", text: "2026-04-24" }],
        },
        {
          role: "assistant",
          timestamp: Date.now(),
          stopReason: "stop",
          content: [{ type: "text", text: "今天是 2026-04-24。" }],
        },
        {
          role: "user",
          timestamp: Date.now(),
          content: [{ type: "text", text: "谢谢" }],
        },
      ]),
      tools: {
        get_date: tool({
          description: "Get current date",
          inputSchema: z.object({}),
        }),
      },
    });

    const requestMessages = bodies[0]?.messages as Array<Record<string, unknown>>;
    assert.equal(requestMessages[1]?.reasoning_content, "Need to call the date tool first.");
  } finally {
    globalThis.fetch = previousFetch;
  }
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

test("kimi-coding provider uses anthropic-compatible provider package", () => {
  const { model } = createLanguageModel("kimi-coding", "kimi-for-coding", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^anthropic/);
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
