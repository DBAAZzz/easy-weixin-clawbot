/**
 * Legacy context build (Phase 6 design §8.2) — the Phase 5 behavior, verbatim:
 * live cached history + Tape memory recall. This stays the model-visible path
 * for `read_path = legacy` accounts, for dual-period production turns, and as
 * the per-turn fallback target whenever the canonical build fails.
 *
 * Phase 7 adds the memory read-path dispatch (§7.3): `tape` (default) keeps
 * the byte-identical Phase 5 behaviour; `events` injects the memory projection
 * replayed from memory events; `dual` compares both formatted blocks and keeps
 * feeding Tape. Any events-path failure fail-opens to Tape.
 */

import { withSpan } from "@clawbot/observability";
import { memoryProjectionDiffTotal } from "@clawbot/observability";
import type { AgentMessage } from "../../llm/types.js";
import {
  emptyState,
  recall,
  formatMemoryForPrompt,
  GLOBAL_BRANCH,
} from "../../memory/index.js";
import { replayMemoryProjection } from "../../memory/memory-projection.js";
import { getArtifactRevisionStore } from "../../ports/artifact-revision-store.js";
import { getMemoryEventStore } from "../../ports/memory-event-store.js";
import type { MemoryReadPath } from "./index.js";
import { runLogger, type RunContext } from "../context.js";
import type { ConversationCache } from "../conversation/cache.js";

export interface LegacyContext {
  history: AgentMessage[];
  memoryContext: string;
}

function formatTapeMemory(
  ctx: RunContext,
  sessionMemory: Awaited<ReturnType<typeof recall>>,
  globalMemory: Awaited<ReturnType<typeof recall>>,
): string {
  return formatMemoryForPrompt(globalMemory, sessionMemory);
}

/**
 * Load message history and memory (session + global) in parallel, returning
 * the live history array and the formatted memory block for prompt injection.
 */
export async function loadLegacyContext(
  cache: ConversationCache,
  ctx: RunContext,
  options: { memoryReadPath?: MemoryReadPath } = {},
): Promise<LegacyContext> {
  const memoryReadPath = options.memoryReadPath ?? "tape";
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

  const tapeContext = formatTapeMemory(ctx, sessionMemory, globalMemory);
  if (memoryReadPath === "tape") {
    return { history: cache.get(ctx.accountId, ctx.conversationId), memoryContext: tapeContext };
  }

  // events / dual: replay the projection from memory events. Tape recall above
  // stays the comparison baseline (dual) and the fail-open target.
  try {
    const [sessionEvents, globalEvents] = await Promise.all([
      replayMemoryProjection({
        accountId: ctx.accountId,
        branch: ctx.conversationId,
        memoryEventStore: getMemoryEventStore(),
        artifactRevisionStore: getArtifactRevisionStore(),
      }),
      replayMemoryProjection({
        accountId: ctx.accountId,
        branch: GLOBAL_BRANCH,
        memoryEventStore: getMemoryEventStore(),
        artifactRevisionStore: getArtifactRevisionStore(),
      }),
    ]);
    const eventsContext = formatMemoryForPrompt(globalEvents, sessionEvents);

    if (memoryReadPath === "dual") {
      memoryProjectionDiffTotal.inc({
        result: eventsContext === tapeContext ? "same" : "different",
      });
      // Dual feeds Tape: production behaviour unchanged (§7.3).
      return { history: cache.get(ctx.accountId, ctx.conversationId), memoryContext: tapeContext };
    }

    return {
      history: cache.get(ctx.accountId, ctx.conversationId),
      memoryContext: eventsContext,
    };
  } catch (error) {
    memoryProjectionDiffTotal.inc({ result: "failed" });
    runLogger(ctx).warn("memory projection replay failed; falling back to tape", { err: error });
    return { history: cache.get(ctx.accountId, ctx.conversationId), memoryContext: tapeContext };
  }
}
