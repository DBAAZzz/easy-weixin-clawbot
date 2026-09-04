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
import type { TriggerMeta } from "../llm/types.js";
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
  /**
   * Role under which the prompt is recorded. Defaults to "user".
   * Use "trigger" for system-originated turns (a fired reminder) so history
   * shows the cause without attributing the prompt to the user.
   */
  inputRole?: "user" | "trigger";
  /** Required when inputRole is "trigger". */
  triggerMeta?: TriggerMeta;
  /**
   * Phase 6：trigger run 的确定性身份（design §5.1）。存在时实现方据此构造
   * run ledger trigger run；缺省（或 rollout 关闭）→ 行为回落 Phase 5。
   * fireAt 是本次触发的既定时刻（heartbeat 的 due 水位 / scheduler 的
   * nextRunAt），同一 (entity, fireAt) 重执行收敛到同一 run 链。
   */
  triggerIdentity?: {
    source: "heartbeat" | "scheduler";
    entityId: string;
    fireAtISO: string;
  };
}

export interface ChatExecutionResult {
  text?: string;
  status: "completed" | "error";
  error?: string;
  /** Phase 6：trigger run 的 runId（run ledger 启用且未降级时存在）。 */
  runId?: string;
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
