import test from "node:test";
import assert from "node:assert/strict";
import { estimateMessageTokens } from "../../src/conversation/token-estimator.js";
import type { AssistantMessage } from "../../src/llm/types.js";

test("estimateMessageTokens does not throw on malformed toolCall arguments", () => {
  const malformedAssistant: AssistantMessage = {
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

  assert.doesNotThrow(() => estimateMessageTokens(malformedAssistant));
  const tokens = estimateMessageTokens(malformedAssistant);
  assert.equal(Number.isFinite(tokens), true);
  assert.equal(tokens > 0, true);
});
