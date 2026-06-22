export interface AgentToolContext {
  accountId: string;
  conversationId: string;
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

/**
 * Creates an isolated per-tool-family context slot.
 *
 * The server sets this around a chat execution and must clear it afterwards;
 * callers that run tools outside that window should expect require() to throw.
 */
export function createToolContextSlot(): {
  set(ctx: AgentToolContext | null): void;
  get(): AgentToolContext | null;
  require(): AgentToolContext;
} {
  let current: AgentToolContext | null = null;

  return {
    set(ctx) {
      current = ctx;
    },
    get() {
      return current;
    },
    require() {
      if (!current) throw new ToolContextMissingError();
      return current;
    },
  };
}
