/**
 * Legacy context build (Phase 6 design §8.2) — the Phase 5 behavior, verbatim:
 * live cached history + Tape memory recall. This stays the model-visible path
 * for `read_path = legacy` accounts, for dual-period production turns, and as
 * the per-turn fallback target whenever the canonical build fails.
 */

import { withSpan } from "@clawbot/observability";
import type { AgentMessage } from "../../llm/types.js";
import { emptyState, recall, formatMemoryForPrompt, GLOBAL_BRANCH } from "../../memory/index.js";
import { runLogger, type RunContext } from "../context.js";
import type { ConversationCache } from "../conversation/cache.js";

export interface LegacyContext {
  history: AgentMessage[];
  memoryContext: string;
}

/**
 * Load message history and tape memory (session + global) in parallel, returning
 * the live history array and the formatted memory block for prompt injection.
 */
export async function loadLegacyContext(
  cache: ConversationCache,
  ctx: RunContext,
): Promise<LegacyContext> {
  const [, [sessionMemory, globalMemory]] = await Promise.all([
    withSpan("history.load", { conversationId: ctx.conversationId, accountId: ctx.accountId }, () =>
      cache.ensureLoaded(ctx.accountId, ctx.conversationId),
    ),
    withSpan("tape.recall", { conversationId: ctx.conversationId, accountId: ctx.accountId }, () =>
      Promise.all([
        recall(ctx.accountId, ctx.conversationId),
        recall(ctx.accountId, GLOBAL_BRANCH),
      ]).catch((err) => {
        runLogger(ctx).warn("tape recall failed, proceeding without memory", { err });
        return [emptyState(), emptyState()] as const;
      }),
    ),
  ]);

  return {
    history: cache.get(ctx.accountId, ctx.conversationId),
    memoryContext: formatMemoryForPrompt(globalMemory, sessionMemory),
  };
}
