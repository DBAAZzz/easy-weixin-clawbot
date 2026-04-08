/**
 * Context-window trimming — keeps message history within the model's token budget.
 *
 * Pure function: returns a **new** array; the original history is never mutated.
 *
 * Trimming levels (applied in order until budget is met):
 *   Level 0 — no trimming needed
 *   Level 1 — degrade images in older messages to placeholder text
 *   Level 2 — sliding-window: drop earliest messages
 */

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
} from "@mariozechner/pi-ai";
import {
  estimateMessageTokens,
  estimateHistoryTokens,
  withSafetyMargin,
} from "./token-estimator.js";

// ── Public types ─────────────────────────────────────────────────────

export interface ContextWindowConfig {
  /** Model context window size in tokens. */
  contextWindowTokens: number;
  /** Tokens reserved for the model's output. */
  outputReserveTokens: number;
  /** Estimated tokens consumed by systemPrompt + tools schema. */
  fixedOverheadTokens: number;
  /** Minimum number of recent user-assistant turns to always preserve (default 2). */
  minRecentTurns?: number;
}

export interface TrimResult {
  /** Trimmed message array ready to pass to the LLM. */
  messages: Message[];
  /** Trim level applied: 0 = none, 1 = image degradation, 2 = sliding window. */
  trimLevel: 0 | 1 | 2;
  /** Estimated tokens of the original history. */
  originalTokens: number;
  /** Estimated tokens after trimming. */
  trimmedTokens: number;
  /** Number of messages dropped (Level 2 only). */
  droppedMessageCount: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

const IMAGE_PLACEHOLDER: TextContent = {
  type: "text",
  text: "[图片: 已省略]",
};

/** Count backward from end to find the index where the last N user turns start. */
function findRecentTurnsBoundary(messages: Message[], minTurns: number): number {
  let userCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userCount++;
      if (userCount >= minTurns) return i;
    }
  }
  return 0;
}

/**
 * Check if a message contains image content.
 */
function hasImage(message: Message): boolean {
  if (message.role === "user") {
    const user = message as UserMessage;
    if (typeof user.content === "string") return false;
    return user.content.some((b) => b.type === "image");
  }
  if (message.role === "toolResult") {
    const tr = message as ToolResultMessage;
    return tr.content.some((b) => b.type === "image");
  }
  return false;
}

/** Replace image blocks with a text placeholder. Returns a shallow clone. */
function degradeImages(message: Message): Message {
  if (message.role === "user") {
    const user = message as UserMessage;
    if (typeof user.content === "string") return message;
    const newContent = user.content.map((block) =>
      block.type === "image" ? IMAGE_PLACEHOLDER : block,
    );
    return { ...user, content: newContent } as UserMessage;
  }

  if (message.role === "toolResult") {
    const tr = message as ToolResultMessage;
    const newContent = tr.content.map((block) =>
      block.type === "image" ? IMAGE_PLACEHOLDER : block,
    );
    return { ...tr, content: newContent } as ToolResultMessage;
  }

  return message;
}

/**
 * Find a safe cut point that doesn't break tool_call / tool_result pairs.
 *
 * Rules:
 *  - Never cut in the middle of a toolResult sequence (they must follow their assistant).
 *  - If the message at `index` is a toolResult, advance past the group.
 *  - If the message at `index` is an assistant with toolUse stopReason,
 *    advance past its corresponding toolResults.
 *  - The first kept message must be a user message (API requirement).
 */
function findSafeCutIndex(messages: Message[], rawIndex: number): number {
  let idx = rawIndex;

  // Skip past any toolResult messages at the cut point
  while (idx < messages.length && messages[idx].role === "toolResult") {
    idx++;
  }

  // If we landed on an assistant message that has tool calls,
  // skip it and its following toolResults too
  while (idx < messages.length && messages[idx].role === "assistant") {
    const assistant = messages[idx] as AssistantMessage;
    const hasToolCalls = assistant.content.some((b) => b.type === "toolCall");
    if (!hasToolCalls) break;
    idx++; // skip the assistant
    while (idx < messages.length && messages[idx].role === "toolResult") {
      idx++; // skip its tool results
    }
  }

  // Ensure we start with a user message
  while (idx < messages.length && messages[idx].role !== "user") {
    idx++;
  }

  return idx;
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Trim `messages` to fit within the model's context window budget.
 *
 * The caller is responsible for estimating `fixedOverheadTokens`
 * (systemPrompt + tools schema + memory prompt).
 */
export function fitToContextWindow(
  messages: Message[],
  config: ContextWindowConfig,
): TrimResult {
  const budget =
    config.contextWindowTokens -
    config.outputReserveTokens -
    config.fixedOverheadTokens;

  const originalTokens = estimateHistoryTokens(messages);

  // ── Level 0: fits already ──
  if (withSafetyMargin(originalTokens) <= budget) {
    return {
      messages,
      trimLevel: 0,
      originalTokens,
      trimmedTokens: originalTokens,
      droppedMessageCount: 0,
    };
  }

  const minTurns = config.minRecentTurns ?? 2;
  const recentBoundary = findRecentTurnsBoundary(messages, minTurns);

  // ── Level 1: degrade images in older messages ──
  const level1Messages = messages.map((msg, i) => {
    if (i >= recentBoundary) return msg; // keep recent messages intact
    if (!hasImage(msg)) return msg;
    return degradeImages(msg);
  });

  const level1Tokens = estimateHistoryTokens(level1Messages);
  if (withSafetyMargin(level1Tokens) <= budget) {
    return {
      messages: level1Messages,
      trimLevel: 1,
      originalTokens,
      trimmedTokens: level1Tokens,
      droppedMessageCount: 0,
    };
  }

  // ── Level 2: sliding window on top of Level 1 ──
  // Work with the image-degraded version so we don't lose the Level 1 savings.
  // Walk from the front, accumulating tokens to drop.

  // First compute per-message token costs for the level1 array
  const perMsg = level1Messages.map((m) => estimateMessageTokens(m));
  const totalLevel1 = perMsg.reduce((a, b) => a + b, 0);
  const excess = withSafetyMargin(totalLevel1) - budget;

  // Find how many leading messages to drop to reclaim `excess` tokens.
  let dropped = 0;
  let reclaimed = 0;
  for (let i = 0; i < recentBoundary && reclaimed < excess; i++) {
    reclaimed += perMsg[i];
    dropped = i + 1;
  }

  // Snap to a safe boundary (don't break tool pairs, ensure starts with user)
  const safeCut = findSafeCutIndex(level1Messages, dropped);

  // Build the placeholder + remaining messages
  const remaining = level1Messages.slice(safeCut);
  const droppedCount = safeCut;

  const ellipsis: UserMessage = {
    role: "user",
    content: `[以上 ${droppedCount} 条早期对话已省略]`,
    timestamp: remaining.length > 0 ? (remaining[0] as any).timestamp ?? Date.now() : Date.now(),
  };

  const trimmed = [ellipsis, ...remaining];
  const trimmedTokens = estimateHistoryTokens(trimmed);

  return {
    messages: trimmed,
    trimLevel: 2,
    originalTokens,
    trimmedTokens,
    droppedMessageCount: droppedCount,
  };
}
