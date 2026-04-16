import type { Command } from "./types.js";

export const resetCommand: Command = {
  name: "reset",
  description: "开启新会话（旧会话在 DB 中存档保留）",
  async execute(ctx) {
    await ctx.rotateSession();
    return { text: "已开启新会话，之前的对话已存档。" };
  },
};
