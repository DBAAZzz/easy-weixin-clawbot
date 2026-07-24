/**
 * Server-side implementation of ChatExecutorPort.
 *
 * Wraps ChatEngine.chat() with conversations.withLock() to ensure proper
 * locking. Shared by both the scheduler and heartbeat capabilities — the
 * request's runKind determines which one's calling.
 */

import type {
  ChatExecutorPort,
  ChatExecutionRequest,
  ChatExecutionResult,
  ChatEngine,
  RunContext,
} from "@clawbot/agent";

export function createChatExecutor(chatEngine: ChatEngine): ChatExecutorPort {
  return {
    async execute(req: ChatExecutionRequest): Promise<ChatExecutionResult> {
      return chatEngine.conversations.withLock(req.accountId, req.conversationId, async () => {
        try {
          const ctx: RunContext = {
            accountId: req.accountId,
            conversationId: req.conversationId,
            targetConversationId: req.targetConversationId ?? req.conversationId,
            runKind: req.runKind,
            signal: req.signal,
          };
          const result = await chatEngine.chat(ctx, { text: req.prompt });
          return { text: result.text, status: "completed" as const };
        } catch (err) {
          return { status: "error" as const, error: (err as Error).message };
        }
      });
    },
  };
}
