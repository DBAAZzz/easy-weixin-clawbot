import test from "node:test";
import assert from "node:assert/strict";
import {
  agentToModelMessages,
  legacyPayloadToAgentMessage,
  mapModelResultToAssistantMessage,
  replaceImagesWithTextPlaceholders,
  stripUnreasonedToolCallHistory,
  TEXT_ONLY_IMAGE_PLACEHOLDER,
} from "./messages.js";
import type { AgentMessage, AssistantMessage } from "./types.js";

test("agentToModelMessages normalizes malformed toolCall arguments to object input", () => {
  const assistant: AssistantMessage = {
    role: "assistant",
    timestamp: Date.now(),
    content: [
      {
        type: "toolCall",
        id: "call_1",
        name: "mcp__brave-search__brave_web_search",
        arguments: undefined as unknown as Record<string, unknown>,
      },
    ],
  };

  const [message] = agentToModelMessages([assistant]);
  assert.equal(message.role, "assistant");
  assert.deepEqual((message.content as Array<Record<string, unknown>>)[0]?.input, {});
});

test("mapModelResultToAssistantMessage converts text, reasoning, and tool calls", () => {
  const message = mapModelResultToAssistantMessage(
    {
      content: [
        { type: "text", text: "I will check." },
        { type: "reasoning", text: "Need one tool call." },
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "web_search",
          input: { query: "today news" },
        },
      ],
      finishReason: "tool-calls",
      usage: { inputTokens: 12, outputTokens: 34 },
      response: { modelId: "provider-model" },
    },
    "fallback-model",
  );

  assert.equal(message.role, "assistant");
  assert.equal(message.model, "provider-model");
  assert.equal(message.stopReason, "toolUse");
  assert.deepEqual(message.usage, { input: 12, output: 34 });
  assert.deepEqual(message.content, [
    { type: "text", text: "I will check." },
    { type: "thinking", thinking: "Need one tool call." },
    {
      type: "toolCall",
      id: "call_1",
      name: "web_search",
      arguments: { query: "today news" },
    },
  ]);
});

test("mapModelResultToAssistantMessage falls back to model id and normalizes args", () => {
  const message = mapModelResultToAssistantMessage(
    {
      content: [
        {
          type: "tool-call",
          toolCallId: "call_1",
          toolName: "web_search",
          args: "invalid",
        },
      ],
      finishReason: "stop",
      usage: {},
    },
    "fallback-model",
  );

  assert.equal(message.model, "fallback-model");
  assert.equal(message.stopReason, "stop");
  assert.deepEqual(message.usage, { input: 0, output: 0 });
  assert.deepEqual(message.content, [
    {
      type: "toolCall",
      id: "call_1",
      name: "web_search",
      arguments: {},
    },
  ]);
});

test("legacyPayloadToAgentMessage accepts toolCall input field from stored payload", () => {
  const message = legacyPayloadToAgentMessage({
    role: "assistant",
    timestamp: Date.now(),
    content: [
      {
        type: "toolCall",
        id: "call_1",
        name: "mcp__brave-search__brave_web_search",
        input: { query: "today news" },
      },
    ],
  });

  assert.equal(message.role, "assistant");
  const [block] = message.content;
  assert.equal(block?.type, "toolCall");
  assert.deepEqual(block?.arguments, { query: "today news" });
});

test("stripUnreasonedToolCallHistory removes stale tool calls and matching results", () => {
  const messages: AgentMessage[] = [
    {
      role: "user",
      timestamp: Date.now(),
      content: [{ type: "text", text: "news?" }],
    },
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          id: "call_1",
          name: "web_search",
          arguments: { query: "today news" },
        },
        { type: "text", text: "I will search." },
      ],
    },
    {
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: "call_1",
      toolName: "web_search",
      isError: false,
      content: [{ type: "text", text: "result" }],
    },
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "stop",
      content: [{ type: "text", text: "final answer" }],
    },
  ];

  const stripped = stripUnreasonedToolCallHistory(messages);

  assert.equal(stripped.length, 3);
  assert.equal(stripped[1]?.role, "assistant");
  assert.deepEqual((stripped[1] as AssistantMessage).content, [
    { type: "text", text: "I will search." },
  ]);
  assert.equal(stripped.some((message) => message.role === "toolResult"), false);
});

test("stripUnreasonedToolCallHistory keeps reasoned tool calls intact", () => {
  const messages: AgentMessage[] = [
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "Need search." },
        {
          type: "toolCall",
          id: "call_1",
          name: "web_search",
          arguments: { query: "today news" },
        },
      ],
    },
    {
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: "call_1",
      toolName: "web_search",
      isError: false,
      content: [{ type: "text", text: "result" }],
    },
  ];

  assert.deepEqual(stripUnreasonedToolCallHistory(messages), messages);
});

test("replaceImagesWithTextPlaceholders converts user images before model conversion", () => {
  const messages: AgentMessage[] = [
    {
      role: "user",
      timestamp: Date.now(),
      content: [
        { type: "text", text: "看这张图" },
        { type: "image", data: "base64-image", mimeType: "image/png" },
      ],
    },
  ];

  const downgraded = replaceImagesWithTextPlaceholders(messages);
  const [modelMessage] = agentToModelMessages(downgraded);

  assert.equal(modelMessage.role, "user");
  assert.deepEqual(modelMessage.content, [
    { type: "text", text: "看这张图" },
    { type: "text", text: TEXT_ONLY_IMAGE_PLACEHOLDER },
  ]);
});

test("replaceImagesWithTextPlaceholders honors image-specific replacement text", () => {
  const messages: AgentMessage[] = [
    {
      role: "user",
      timestamp: Date.now(),
      content: [
        { type: "text", text: "看这张图" },
        {
          type: "image",
          data: "base64-image",
          mimeType: "image/png",
          promptReplacementText: "[visual context already injected]",
        },
      ],
    },
  ];

  const downgraded = replaceImagesWithTextPlaceholders(messages);
  const [modelMessage] = agentToModelMessages(downgraded);

  assert.equal(modelMessage.role, "user");
  assert.deepEqual(modelMessage.content, [
    { type: "text", text: "看这张图" },
    { type: "text", text: "[visual context already injected]" },
  ]);
});

test("replaceImagesWithTextPlaceholders converts tool-result images", () => {
  const messages: AgentMessage[] = [
    {
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: "call_1",
      toolName: "screenshot",
      isError: false,
      content: [
        { type: "image", data: "base64-image", mimeType: "image/png" },
      ],
    },
  ];

  const [message] = replaceImagesWithTextPlaceholders(messages);

  assert.equal(message?.role, "toolResult");
  assert.deepEqual(message?.content, [
    { type: "text", text: TEXT_ONLY_IMAGE_PLACEHOLDER },
  ]);
});
