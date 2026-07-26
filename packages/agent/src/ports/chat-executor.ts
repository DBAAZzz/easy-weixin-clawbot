/**
 * ChatExecutorPort — agent-defined interface for running a full chat() turn
 * from inside a capability (scheduler, heartbeat) without those capabilities
 * depending on the engine layer directly (which would be a reverse edge).
 *
 * Locking lives in the server layer (ChatEngine.conversations.withLock), so
 * this port lets a capability request execution while server provides the
 * lock-wrapped implementation.
 */

import type { RunKind } from "../capabilities/tools/types.js";
import { createPortSlot } from "./slot.js";

export interface ChatExecutionRequest {
  accountId: string;
  /** Execution session — see RunContext.conversationId. */
  conversationId: string;
  /** Push target / new-task ownership — see RunContext.targetConversationId. */
  targetConversationId?: string;
  prompt: string;
  runKind: RunKind;
  signal?: AbortSignal;
}

export interface ChatExecutionResult {
  text?: string;
  status: "completed" | "error";
  error?: string;
}

export interface ChatExecutorPort {
  /**
   * Execute a chat() call. Implementation MUST wrap with
   * ChatEngine.conversations.withLock() on the execution conversation.
   */
  execute(req: ChatExecutionRequest): Promise<ChatExecutionResult>;
}

export const { set: setChatExecutor, get: getChatExecutor } =
  createPortSlot<ChatExecutorPort>("ChatExecutorPort", "setChatExecutor");
