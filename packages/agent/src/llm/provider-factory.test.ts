import test from "node:test";
import assert from "node:assert/strict";
import { generateText, tool } from "ai";
import { z } from "zod";
import { agentToModelMessages } from "./messages.js";
import { createLanguageModel } from "./provider-factory.js";

async function assertProviderIgnoresEnvApiKey(options: {
  testName: string;
  provider: string;
  modelId: string;
  envKey: string;
}): Promise<void> {
  const previousEnvValue = process.env[options.envKey];
  const previousFetch = globalThis.fetch;

  try {
    process.env[options.envKey] = "test-key-from-env";

    let fetchCalled = false;
    let authorizationHeader: string | null = null;
    globalThis.fetch = async (_input, init) => {
      fetchCalled = true;
      authorizationHeader = new Headers(init?.headers).get("authorization");
      throw new Error("network blocked for unit test");
    };

    const { model } = createLanguageModel(options.provider, options.modelId);

    await assert.rejects(
      () =>
        generateText({
          model,
          messages: [{ role: "user", content: "hi" }],
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /network blocked/i, options.testName);
        return true;
      },
    );

    assert.equal(fetchCalled, true, options.testName);
    assert.notEqual(authorizationHeader, "Bearer test-key-from-env", options.testName);
  } finally {
    if (previousEnvValue === undefined) {
      delete process.env[options.envKey];
    } else {
      process.env[options.envKey] = previousEnvValue;
    }

    globalThis.fetch = previousFetch;
  }
}

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

test("xiaomi provider uses openai-compatible provider package", () => {
  const { model } = createLanguageModel("xiaomi", "MiMo-V2.5-Pro", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^xiaomi/);
});

test("xiaomi provider lowercases display-style model ids before sending upstream", async () => {
  const previousFetch = globalThis.fetch;
  let requestModel = "";

  try {
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model?: string };
      requestModel = body.model ?? "";
      throw new Error("network blocked for unit test");
    };

    const { model } = createLanguageModel("xiaomi", "MiMo-V2-Pro", {
      apiKey: "test-key",
    });

    await assert.rejects(
      () =>
        generateText({
          model,
          messages: [{ role: "user", content: "hi" }],
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /network blocked/);
        return true;
      },
    );

    assert.equal(requestModel, "mimo-v2-pro");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("xiaomi-anthropic provider uses anthropic-compatible provider package", () => {
  const { model } = createLanguageModel("xiaomi-anthropic", "MiMo-V2.5-Pro", {
    apiKey: "test-key",
  });

  assert.match((model as { provider?: string }).provider ?? "", /^xiaomi-anthropic/);
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

test("openai provider uses configured baseUrl", async () => {
  const previousFetch = globalThis.fetch;
  let requestUrl = "";

  try {
    globalThis.fetch = async (input) => {
      requestUrl = input instanceof Request ? input.url : String(input);
      throw new Error("network blocked for unit test");
    };

    const { model } = createLanguageModel("openai", "gpt-4o", {
      apiKey: "test-key",
      baseUrl: "https://proxy.example/v1",
    });

    await assert.rejects(
      () =>
        generateText({
          model,
          messages: [{ role: "user", content: "hi" }],
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /network blocked/);
        return true;
      },
    );

    assert.match(requestUrl, /^https:\/\/proxy\.example\/v1\//);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("openai provider does not read OPENAI_BASE_URL env var fallback", async () => {
  const previousBaseUrl = process.env.OPENAI_BASE_URL;
  const previousFetch = globalThis.fetch;
  let requestUrl = "";

  try {
    process.env.OPENAI_BASE_URL = "https://env-proxy.example/v1";
    globalThis.fetch = async (input) => {
      requestUrl = input instanceof Request ? input.url : String(input);
      throw new Error("network blocked for unit test");
    };

    const { model } = createLanguageModel("openai", "gpt-4o", {
      apiKey: "test-key",
    });

    await assert.rejects(
      () =>
        generateText({
          model,
          messages: [{ role: "user", content: "hi" }],
        }),
      /network blocked/,
    );

    assert.match(requestUrl, /^https:\/\/api\.openai\.com\/v1\//);
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.OPENAI_BASE_URL;
    } else {
      process.env.OPENAI_BASE_URL = previousBaseUrl;
    }

    globalThis.fetch = previousFetch;
  }
});

test("openai provider does not read OPENAI_API_KEY env var fallback", async () => {
  await assertProviderIgnoresEnvApiKey({
    testName: "openai env fallback",
    provider: "openai",
    modelId: "gpt-4o",
    envKey: "OPENAI_API_KEY",
  });
});

test("moonshot provider does not read MOONSHOT_API_KEY env var fallback", async () => {
  await assertProviderIgnoresEnvApiKey({
    testName: "moonshot env fallback",
    provider: "moonshot",
    modelId: "moonshot-v1-8k",
    envKey: "MOONSHOT_API_KEY",
  });
});

test("kimi provider does not read KIMI_API_KEY env var fallback", async () => {
  await assertProviderIgnoresEnvApiKey({
    testName: "kimi env fallback",
    provider: "kimi",
    modelId: "kimi-k2.5",
    envKey: "KIMI_API_KEY",
  });
});
