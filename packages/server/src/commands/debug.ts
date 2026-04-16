import type { Command } from "./types.js";

const debugState = new Map<string, boolean>();

export function isDebugEnabled(accountId: string, conversationId: string): boolean {
  return debugState.get(`${accountId}::${conversationId}`) ?? false;
}

export const debugCommand: Command = {
  name: "debug",
  description: "开关 debug 模式（启用后每条回复追加全链路耗时）",
  async execute(ctx) {
    const key = `${ctx.accountId}::${ctx.conversationId}`;
    const current = debugState.get(key) ?? false;
    debugState.set(key, !current);
    const status = !current ? "已开启" : "已关闭";
    return { text: `Debug 模式${status}。` };
  },
};
