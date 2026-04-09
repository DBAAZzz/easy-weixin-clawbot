/**
 * reasonInternal() — side-effect-free LLM reasoning channel for heartbeat.
 *
 * Unlike chat(), this function:
 *  - Does NOT persist messages to history or DB
 *  - Does NOT trigger memory extraction
 *  - Does NOT load tools or skills
 *  - Does NOT enter the runner loop (single complete() call)
 *  - DOES inherit model config and tape memory from the source conversation
 */

import { complete } from "@mariozechner/pi-ai";
import { resolveModel } from "../model-resolver.js";
import { recall, emptyState, formatMemoryForPrompt } from "../tape/index.js";

export interface ReasonInternalOptions {
  accountId: string;
  /** Source conversation to inherit model config and memory from */
  sourceConversationId: string;
  /** System-level instruction (no skills, no tools) */
  systemPrompt: string;
  /** Input prompt */
  userPrompt: string;
  /** Recent messages from source conversation (if needed) */
  recentContext?: string;
}

export interface ReasonInternalResult {
  text: string;
  usage: { input: number; output: number };
}

export async function reasonInternal(
  options: ReasonInternalOptions,
): Promise<ReasonInternalResult> {
  const { accountId, sourceConversationId, systemPrompt, userPrompt, recentContext } = options;

  // Inherit model config from the source conversation
  const model = await resolveModel(accountId, sourceConversationId, "chat");

  // Read-only recall — get memory context without triggering compact
  const [sessionMemory, globalMemory] = await Promise.all([
    recall(accountId, sourceConversationId).catch(() => emptyState()),
    recall(accountId, "__global__").catch(() => emptyState()),
  ]);

  const memoryContext = formatMemoryForPrompt(globalMemory, sessionMemory);
  const now = new Date();
  const timePrefix = `[当前时间: ${now.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  })}]\n`;

  const parts = [timePrefix];
  if (memoryContext) parts.push(memoryContext + "\n");
  if (recentContext) parts.push(`[源会话近期消息]\n${recentContext}\n`);
  parts.push(userPrompt);

  const result = await complete(
    model.model,
    {
      systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: parts.join("") }],
          timestamp: Date.now(),
        },
      ],
      tools: [],
    },
    model.apiKey ? { apiKey: model.apiKey } : {},
  );

  const text = result.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  return { text, usage: result.usage };
}
