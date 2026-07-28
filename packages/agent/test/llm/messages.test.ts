import test from "node:test";
import assert from "node:assert/strict";
import {
  agentToModelMessages,
  legacyPayloadToAgentMessage,
  mapModelResultToAssistantMessage,
  narrateUnreasonedToolCalls,
  replaceImagesWithTextPlaceholders,
  TEXT_ONLY_IMAGE_PLACEHOLDER,
  TRIGGER_PROMPT_PREFIX,
} from "../../src/llm/messages.js";
import type { AgentMessage, AssistantMessage } from "../../src/llm/types.js";

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

/**
 * Narration replaces the structured tool round-trip with prose. These tests pin
 * the property that motivated it: the *record* of the call survives, because a
 * model that cannot see its own prior call will repeat it — and repeat it every
 * round, since the repeat gets flattened too.
 */
function toolCallHistory(): AgentMessage[] {
  return [
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
}

test("narrateUnreasonedToolCalls folds the round-trip into the assistant turn", () => {
  const narrated = narrateUnreasonedToolCalls(toolCallHistory());

  assert.equal(narrated.length, 3);
  assert.equal(narrated.some((message) => message.role === "toolResult"), false);

  const [call, text] = (narrated[1] as AssistantMessage).content;
  assert.equal(call?.type, "text");
  assert.equal(
    (call as { text: string }).text,
    '[已调用工具 web_search({"query":"today news"})，返回：result]',
  );
  // Surrounding blocks keep their original position.
  assert.deepEqual(text, { type: "text", text: "I will search." });
});

test("narrateUnreasonedToolCalls leaves no tool call the model cannot see", () => {
  const narrated = narrateUnreasonedToolCalls(toolCallHistory());

  const toolCallBlocks = narrated.flatMap((message) =>
    message.role === "assistant"
      ? message.content.filter((block) => block.type === "toolCall")
      : [],
  );
  assert.deepEqual(toolCallBlocks, []);

  const rendered = JSON.stringify(narrated);
  assert.ok(rendered.includes("web_search"), "tool name survives narration");
  assert.ok(rendered.includes("today news"), "tool arguments survive narration");
  assert.ok(rendered.includes("result"), "tool output survives narration");
});

test("narrateUnreasonedToolCalls keeps reasoned tool calls intact", () => {
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

  assert.deepEqual(narrateUnreasonedToolCalls(messages), messages);
});

test("narrateUnreasonedToolCalls states a call that never returned", () => {
  const narrated = narrateUnreasonedToolCalls([
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: "call_1", name: "web_search", arguments: {} }],
    },
  ]);

  assert.equal(narrated.length, 1);
  assert.deepEqual((narrated[0] as AssistantMessage).content, [
    { type: "text", text: "[已调用工具 web_search({})，未返回结果]" },
  ]);
});

test("narrateUnreasonedToolCalls marks error results as errors", () => {
  const narrated = narrateUnreasonedToolCalls([
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: "call_1", name: "web_search", arguments: {} }],
    },
    {
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: "call_1",
      toolName: "web_search",
      isError: true,
      content: [{ type: "text", text: "timeout" }],
    },
  ]);

  assert.deepEqual((narrated[0] as AssistantMessage).content, [
    { type: "text", text: "[已调用工具 web_search({})，返回错误：timeout]" },
  ]);
});

test("narrateUnreasonedToolCalls truncates oversized tool output", () => {
  const narrated = narrateUnreasonedToolCalls([
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: "call_1", name: "web_search", arguments: {} }],
    },
    {
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: "call_1",
      toolName: "web_search",
      isError: false,
      content: [{ type: "text", text: "x".repeat(5000) }],
    },
  ]);

  const [block] = (narrated[0] as AssistantMessage).content;
  const text = (block as { text: string }).text;
  assert.ok(text.includes("（结果已截断）"));
  assert.ok(text.length < 2200, `narration should stay bounded, got ${text.length}`);
});

test("narrateUnreasonedToolCalls drops blank thinking blocks it would otherwise keep", () => {
  const narrated = narrateUnreasonedToolCalls([
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "   " },
        { type: "toolCall", id: "call_1", name: "web_search", arguments: {} },
      ],
    },
  ]);

  const content = (narrated[0] as AssistantMessage).content;
  assert.equal(content.some((block) => block.type === "thinking"), false);
  assert.equal(content.length, 1);
});

test("narrateUnreasonedToolCalls pairs results that are not adjacent to their call", () => {
  const narrated = narrateUnreasonedToolCalls([
    {
      role: "assistant",
      timestamp: Date.now(),
      stopReason: "toolUse",
      content: [
        { type: "toolCall", id: "call_1", name: "a", arguments: {} },
        { type: "toolCall", id: "call_2", name: "b", arguments: {} },
      ],
    },
    {
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: "call_2",
      toolName: "b",
      isError: false,
      content: [{ type: "text", text: "second" }],
    },
    {
      role: "toolResult",
      timestamp: Date.now(),
      toolCallId: "call_1",
      toolName: "a",
      isError: false,
      content: [{ type: "text", text: "first" }],
    },
  ]);

  assert.equal(narrated.length, 1);
  assert.deepEqual((narrated[0] as AssistantMessage).content, [
    { type: "text", text: "[已调用工具 a({})，返回：first]" },
    { type: "text", text: "[已调用工具 b({})，返回：second]" },
  ]);
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

test("agentToModelMessages merges adjacent assistant messages", () => {
  const history: AgentMessage[] = [
    { role: "user", timestamp: 1, content: [{ type: "text", text: "在吗" }] },
    { role: "assistant", timestamp: 2, content: [{ type: "text", text: "在的" }] },
    { role: "assistant", timestamp: 3, content: [{ type: "text", text: "对了，面试结果出了吗" }] },
    { role: "assistant", timestamp: 4, content: [{ type: "text", text: "还有个事" }] },
  ];

  const result = agentToModelMessages(history);

  assert.equal(result.length, 2);
  assert.equal(result[0].role, "user");
  assert.equal(result[1].role, "assistant");
  assert.deepEqual(result[1].content, [
    { type: "text", text: "在的" },
    { type: "text", text: "对了，面试结果出了吗" },
    { type: "text", text: "还有个事" },
  ]);
});

test("agentToModelMessages leaves alternating roles untouched", () => {
  const history: AgentMessage[] = [
    { role: "user", timestamp: 1, content: [{ type: "text", text: "一" }] },
    { role: "assistant", timestamp: 2, content: [{ type: "text", text: "二" }] },
    { role: "user", timestamp: 3, content: [{ type: "text", text: "三" }] },
    { role: "assistant", timestamp: 4, content: [{ type: "text", text: "四" }] },
  ];

  assert.equal(agentToModelMessages(history).length, 4);
});

test("agentToModelMessages does not merge assistants separated by tool results", () => {
  const history: AgentMessage[] = [
    { role: "user", timestamp: 1, content: [{ type: "text", text: "查一下" }] },
    {
      role: "assistant",
      timestamp: 2,
      stopReason: "toolUse",
      content: [{ type: "toolCall", id: "call_1", name: "search", arguments: { q: "x" } }],
    },
    {
      role: "toolResult",
      timestamp: 3,
      toolCallId: "call_1",
      toolName: "search",
      isError: false,
      content: [{ type: "text", text: "结果" }],
    },
    { role: "assistant", timestamp: 4, content: [{ type: "text", text: "查到了" }] },
  ];

  const roles = agentToModelMessages(history).map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "tool", "assistant"]);
});

test("agentToModelMessages sends trigger turns as marked user messages", () => {
  const history: AgentMessage[] = [
    {
      role: "trigger",
      timestamp: 1,
      content: [{ type: "text", text: "问问他面试结果" }],
      meta: { kind: "reminder", reminderId: "r-1" },
    },
    { role: "assistant", timestamp: 2, content: [{ type: "text", text: "面试怎么样？" }] },
  ];

  const result = agentToModelMessages(history);

  assert.equal(result.length, 2);
  assert.equal(result[0].role, "user", "trigger must reach the model as a user turn");
  assert.equal(result[0].content, `${TRIGGER_PROMPT_PREFIX} 问问他面试结果`);
  assert.equal(result[1].role, "assistant");
});
