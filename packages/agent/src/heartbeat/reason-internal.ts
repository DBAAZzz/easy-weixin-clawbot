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
import { assembleUserContext } from "../prompts/assembler.js";
import type { PromptProfile } from "../prompts/types.js";

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
  /** Prompt profile controlling which context fragments are injected */
  profile: PromptProfile;
}

export interface ReasonInternalResult {
  text: string;
  usage: { input: number; output: number };
}

export async function reasonInternal(
  options: ReasonInternalOptions,
): Promise<ReasonInternalResult> {
  const { accountId, sourceConversationId, systemPrompt, userPrompt, recentContext, profile } = options;

  // Inherit model config from the source conversation
  const model = await resolveModel(accountId, sourceConversationId, "chat");

  // Read-only recall — only if profile allows tape memory injection
  let memoryContext = "";
  if (profile.injectTapeMemory) {
    const [sessionMemory, globalMemory] = await Promise.all([
      recall(accountId, sourceConversationId).catch(() => emptyState()),
      recall(accountId, "__global__").catch(() => emptyState()),
    ]);
    memoryContext = formatMemoryForPrompt(globalMemory, sessionMemory);
  }

  const assembledText = assembleUserContext(profile, {
    tapeMemory: memoryContext || undefined,
    time: new Date(),
    recentContext: recentContext || undefined,
    userText: userPrompt,
  });

  const result = await complete(
    model.model,
    {
      systemPrompt,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: assembledText }],
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
