/**
 * Token estimator — lightweight heuristic token counting for context window management.
 *
 * No external tokenizer dependency; uses character-length heuristics with a safety margin.
 * Accuracy is sufficient for budget decisions (not billing).
 */

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCall,
} from "@mariozechner/pi-ai";

/**
 * Approximate tokens for a text string (works for mixed CJK + Latin).
 * Also useful externally for estimating systemPrompt / tools schema overhead.
 */
export function estimateTextTokens(text: string): number {
  // CJK characters ≈ 1–2 tokens each; Latin words ≈ 1 token per ~4 chars.
  // Using length/3 is a conservative middle ground for mixed content.
  return Math.ceil(text.length / 3);
}

/** Approximate tokens for a base64-encoded image. */
function estimateImageTokens(data: string): number {
  // base64 → raw bytes → estimate tokens
  // Most vision APIs charge by tile; 1 tile ≈ 85 tokens for small images,
  // but we use a rough byte-based heuristic as a safe upper bound.
  const rawBytes = data.length * 0.75;
  return Math.ceil(rawBytes / 3);
}

function estimateContentBlock(
  block: TextContent | ImageContent | ThinkingContent | ToolCall,
): number {
  switch (block.type) {
    case "text":
      return estimateTextTokens(block.text);
    case "image":
      return estimateImageTokens(block.data);
    case "thinking":
      return estimateTextTokens(block.thinking);
    case "toolCall": {
      // name + serialized arguments
      const argText = JSON.stringify(block.arguments);
      return estimateTextTokens(block.name) + estimateTextTokens(argText);
    }
    default:
      return 0;
  }
}

/** Estimate tokens for a single message. */
export function estimateMessageTokens(message: Message): number {
  // Per-message overhead (role tokens, separators, etc.)
  const MESSAGE_OVERHEAD = 4;

  if (message.role === "user") {
    const user = message as UserMessage;
    if (typeof user.content === "string") {
      return MESSAGE_OVERHEAD + estimateTextTokens(user.content);
    }
    return MESSAGE_OVERHEAD + user.content.reduce(
      (sum, block) => sum + estimateContentBlock(block as TextContent | ImageContent),
      0,
    );
  }

  if (message.role === "assistant") {
    const assistant = message as AssistantMessage;
    return MESSAGE_OVERHEAD + assistant.content.reduce(
      (sum, block) => sum + estimateContentBlock(block),
      0,
    );
  }

  // toolResult
  const toolResult = message as ToolResultMessage;
  return MESSAGE_OVERHEAD + toolResult.content.reduce(
    (sum, block) => sum + estimateContentBlock(block as TextContent | ImageContent),
    0,
  );
}

/** Estimate total tokens for an array of messages. */
export function estimateHistoryTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Apply a 10% safety margin to a raw token estimate.
 * Use this when computing budgets, not when measuring.
 */
export function withSafetyMargin(tokens: number): number {
  return Math.ceil(tokens * 1.1);
}
