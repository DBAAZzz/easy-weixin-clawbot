/**
 * Server-side implementation of HeartbeatExecutorPort.
 *
 * Wraps chat() with withConversationLock() and run-scoped tool context
 * to ensure proper locking and prevent recursive goal creation.
 */

import type { HeartbeatExecutorPort } from "@clawbot/agent/ports";
import type { HeartbeatExecutionRequest, HeartbeatExecutionResult } from "@clawbot/agent";
import {
  chat,
  withConversationLock,
} from "@clawbot/agent";

export function createHeartbeatExecutor(): HeartbeatExecutorPort {
  return {
    async execute(req: HeartbeatExecutionRequest): Promise<HeartbeatExecutionResult> {
      return withConversationLock(req.accountId, req.conversationId, async () => {
        try {
          const result = await chat(req.accountId, req.conversationId, req.prompt, undefined, Date.now(), {
            toolContext: {
              accountId: req.accountId,
              conversationId: req.conversationId,
              targetConversationId: req.conversationId,
              runKind: "heartbeat",
            },
          });
          return { text: result.text, status: "completed" as const };
        } catch (err) {
          return { status: "error" as const, error: (err as Error).message };
        }
      });
    },
  };
}
