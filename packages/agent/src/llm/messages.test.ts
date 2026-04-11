import test from "node:test";
import assert from "node:assert/strict";
import { agentToModelMessages, legacyPayloadToAgentMessage } from "./messages.js";
import type { AssistantMessage } from "./types.js";

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
