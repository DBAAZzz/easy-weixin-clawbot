import type { Logger } from "@clawbot/observability";
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
  logger?: Logger;
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
