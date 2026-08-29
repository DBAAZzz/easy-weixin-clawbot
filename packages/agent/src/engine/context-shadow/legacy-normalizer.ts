import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import type { AgentMessage } from "../../llm/types.js";
import { hashCanonicalValue } from "../../context-compiler/canonical-hash.js";

const legacySummaryBrand: unique symbol = Symbol("LegacyContextSummary");

export interface LegacyUserSummaryEntry {
  normalizedText: string;
  hasRuntimeTime: boolean;
  hasTapeMemory: boolean;
  hasVisualFallback: boolean;
  quotedDisplayOnly: boolean;
}

export interface LegacyContextSummary {
  readonly [legacySummaryBrand]: true;
  userEntries: LegacyUserSummaryEntry[];
  assistantEntryCount: number;
  toolEntryCount: number;
  roleOrder: Array<"user" | "assistant" | "tool">;
  hash: string;
}

function textFromMessage(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === MESSAGE_CONTENT_TYPE.TEXT)
    .map((block) => block.text)
    .join("\n");
}

function normalizeUserText(message: AgentMessage): LegacyUserSummaryEntry {
  let text = textFromMessage(message);
  const hasRuntimeTime = /^\[当前时间:[^\]]+\]\n/u.test(text);
  if (hasRuntimeTime) text = text.replace(/^\[当前时间:[^\]]+\]\n/u, "");

  const hasTapeMemory = /<memory>[\s\S]*?<\/memory>\n?/u.test(text);
  if (hasTapeMemory) text = text.replace(/<memory>[\s\S]*?<\/memory>\n?/gu, "");

  const visualPattern = /<visual_context(?:\s[^>]*)?>[\s\S]*?<\/visual_context>\n?/gu;
  const hasVisualFallback =
    visualPattern.test(text) ||
    (message.role === MESSAGE_ROLE.USER && Boolean(message.visualContext?.length)) ||
    text.includes("[图片：当前 chat 模型不支持视觉输入");
  visualPattern.lastIndex = 0;
  text = text.replace(visualPattern, "");
  text = text.replace(/^\[图片：当前 chat 模型不支持视觉输入[^\]]*\]\n?/gmu, "");

  const quotedDisplayOnly = /^\[引用:[^\]]*\]\n/u.test(text);
  if (quotedDisplayOnly) text = text.replace(/^\[引用:[^\]]*\]\n/u, "");

  return {
    normalizedText: text,
    hasRuntimeTime,
    hasTapeMemory,
    hasVisualFallback,
    quotedDisplayOnly,
  };
}

export function normalizeLegacyContext(messages: AgentMessage[]): LegacyContextSummary {
  const userEntries: LegacyUserSummaryEntry[] = [];
  let assistantEntryCount = 0;
  let toolEntryCount = 0;
  const roleOrder: LegacyContextSummary["roleOrder"] = [];

  for (const message of messages) {
    if (message.role === MESSAGE_ROLE.USER) {
      userEntries.push(normalizeUserText(message));
      roleOrder.push("user");
    } else if (message.role === MESSAGE_ROLE.ASSISTANT) {
      assistantEntryCount += 1;
      roleOrder.push("assistant");
    } else if (message.role === MESSAGE_ROLE.TOOL_RESULT) {
      toolEntryCount += 1;
      roleOrder.push("tool");
    }
  }

  const hash = hashCanonicalValue({
    userEntries,
    assistantEntryCount,
    toolEntryCount,
    roleOrder,
  });
  return {
    [legacySummaryBrand]: true,
    userEntries,
    assistantEntryCount,
    toolEntryCount,
    roleOrder,
    hash,
  };
}
