/**
 * HeartbeatExecutorPort — agent-defined interface for Phase 2 execution.
 *
 * Phase 2 needs to run chat() in the original conversation with proper locking.
 * Since locking lives in the server layer, this port lets agent request execution
 * while server provides the lock-wrapped implementation.
 */

import type { HeartbeatExecutionRequest, HeartbeatExecutionResult } from "../heartbeat/types.js";

export type { HeartbeatExecutionRequest, HeartbeatExecutionResult };

export interface HeartbeatExecutorPort {
  /**
   * Execute a chat() call in the original conversation.
   * Implementation MUST wrap with withConversationLock().
   * Results are written to conversation history (intentional — Phase 2 is real action).
   */
  execute(req: HeartbeatExecutionRequest): Promise<HeartbeatExecutionResult>;
}

let executor: HeartbeatExecutorPort | null = null;

export function setHeartbeatExecutor(impl: HeartbeatExecutorPort): void {
  executor = impl;
}

export function getHeartbeatExecutor(): HeartbeatExecutorPort {
  if (!executor)
    throw new Error("HeartbeatExecutorPort not initialized — call setHeartbeatExecutor() at startup");
  return executor;
}
