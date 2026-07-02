import type { RunKind, ToolContext } from "../tools/types.js";

export interface AgentToolContext {
  accountId: string;
  conversationId: string;
  targetConversationId?: string;
  runKind?: RunKind;
}

export class ToolContextMissingError extends Error {
  constructor() {
    super("Agent tool context is missing");
    this.name = "ToolContextMissingError";
  }
}

export function isToolContextMissingError(error: unknown): error is ToolContextMissingError {
  return error instanceof ToolContextMissingError;
}

export function requireAgentToolContext(ctx: ToolContext): AgentToolContext {
  if (!ctx.accountId || !ctx.conversationId) {
    throw new ToolContextMissingError();
  }

  return {
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    targetConversationId: ctx.targetConversationId,
    runKind: ctx.runKind,
  };
}
