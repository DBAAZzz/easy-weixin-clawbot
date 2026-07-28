import type { ChatResponse } from "../shared/types.js";
import type { AgentRunner } from "./runner.js";
import type { RunContext } from "./context.js";
import { createConversationCache, type ConversationCache } from "./conversation/cache.js";
import { generateConversationTitle } from "./conversation/title.js";
import { createDebugFlags, type DebugFlags } from "../commands/debug.js";
import { runChatTurn, type ChatLog, type ChatTurnInput } from "./turn.js";

export type { ChatLog };

export interface ChatEngine {
  readonly conversations: ConversationCache;
  readonly debugFlags: DebugFlags;
  chat(ctx: RunContext, input: ChatTurnInput): Promise<ChatResponse>;
  generateConversationTitle(
    ctx: RunContext,
    turn: { userText: string; assistantText: string },
  ): Promise<string | null>;
}

export function createChatEngine(deps: {
  runner: AgentRunner;
  log: ChatLog;
  conversations?: ConversationCache;
  debugFlags?: DebugFlags;
}): ChatEngine {
  const conversations = deps.conversations ?? createConversationCache();
  const debugFlags = deps.debugFlags ?? createDebugFlags();

  return {
    conversations,
    debugFlags,

    chat(ctx, input) {
      return runChatTurn({ runner: deps.runner, log: deps.log, cache: conversations, debugFlags }, ctx, input);
    },

    generateConversationTitle(ctx, turn) {
      return generateConversationTitle(conversations, ctx.accountId, ctx.conversationId, turn);
    },
  };
}
