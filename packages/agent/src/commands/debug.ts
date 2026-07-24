import type { Command } from "./types.js";

export interface DebugFlags {
  isEnabled(accountId: string, conversationId: string): boolean;
  /** Flips the flag for this conversation and returns the new state. */
  toggle(accountId: string, conversationId: string): boolean;
}

export function createDebugFlags(): DebugFlags {
  const state = new Map<string, boolean>();
  const key = (accountId: string, conversationId: string) => `${accountId}::${conversationId}`;

  return {
    isEnabled(accountId, conversationId) {
      return state.get(key(accountId, conversationId)) ?? false;
    },
    toggle(accountId, conversationId) {
      const k = key(accountId, conversationId);
      const next = !(state.get(k) ?? false);
      state.set(k, next);
      return next;
    },
  };
}

export function createDebugCommand(flags: DebugFlags): Command {
  return {
    name: "debug",
    description: "开关 debug 模式（启用后每条回复追加全链路耗时）",
    async execute(ctx) {
      const enabled = flags.toggle(ctx.accountId, ctx.conversationId);
      const status = enabled ? "已开启" : "已关闭";
      return { text: `Debug 模式${status}。` };
    },
  };
}
