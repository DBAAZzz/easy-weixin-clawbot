import { createLogger, type Logger } from "@clawbot/observability";
import type { RunKind, ToolContext } from "../capabilities/tools/types.js";

/**
 * Everything a single `run` needs, threaded through engine/capabilities/memory
 * instead of read from module-level state.
 */
export interface RunContext {
  accountId: string;
  /** Execution session: history / memory / trace ownership. */
  conversationId: string;
  /**
   * Tool-visible & push target conversation. Defaults to `conversationId`.
   * Diverges for scheduled runs, where `conversationId` is the isolated
   * `scheduler:{seq}` execution session and `targetConversationId` is the
   * conversation the task was created in / results get pushed to.
   */
  targetConversationId?: string;
  runKind: RunKind;
  signal?: AbortSignal;
  /**
   * Optional caller-supplied logger. Engine code must not read this directly —
   * go through {@link runLogger}, which supplies a structured fallback so the
   * field can never silently degrade back to bare `console`.
   */
  logger?: Logger;
}

/**
 * The logger for a run, always tagged with the run's identity.
 *
 * Falls back to a structured logger rather than `console` on purpose: an
 * un-injected logger should still produce the same machine-readable fields as
 * an injected one, so engine logs never split into two formats.
 */
export function runLogger(ctx: RunContext): Logger {
  const fields = {
    module: "engine",
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    runKind: ctx.runKind,
  };
  return ctx.logger ? ctx.logger.child(fields) : createLogger(fields);
}

export function toolContextFrom(ctx: RunContext, signal: AbortSignal): ToolContext {
  return {
    signal,
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    targetConversationId: ctx.targetConversationId,
    runKind: ctx.runKind,
  };
}
