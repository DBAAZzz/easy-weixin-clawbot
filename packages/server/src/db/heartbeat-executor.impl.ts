/**
 * Server-side implementation of HeartbeatExecutorPort.
 *
 * Wraps chat() with withConversationLock() and setHeartbeatContext()
 * to ensure proper locking and prevent recursive goal creation.
 */

import type { HeartbeatExecutorPort } from "@clawbot/agent/ports";
import type { HeartbeatExecutionRequest, HeartbeatExecutionResult } from "@clawbot/agent";
import {
  chat,
  withConversationLock,
  setHeartbeatContext,
  setHeartbeatToolContext,
} from "@clawbot/agent";

export function createHeartbeatExecutor(): HeartbeatExecutorPort {
  return {
    async execute(req: HeartbeatExecutionRequest): Promise<HeartbeatExecutionResult> {
      return withConversationLock(req.accountId, req.conversationId, async () => {
        // Mark heartbeat context so create_pending_goal tool is blocked
        setHeartbeatContext(true);
        setHeartbeatToolContext({ accountId: req.accountId, conversationId: req.conversationId });
        try {
          const result = await chat(req.accountId, req.conversationId, req.prompt);
          return { text: result.text, status: "completed" as const };
        } catch (err) {
          return { status: "error" as const, error: (err as Error).message };
        } finally {
          setHeartbeatContext(false);
          setHeartbeatToolContext(null);
        }
      });
    },
  };
}
