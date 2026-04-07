import type { Command } from "./types.js";

export const echoCommand: Command = {
  name: "echo",
  description: "直接回显消息，附带通道耗时统计",
  async execute(ctx) {
    const elapsed = Date.now() - ctx.startedAt;
    const content = ctx.args || "(空消息)";
    return { text: `${content}\n\n⏱ 通道耗时: ${elapsed}ms` };
  },
};
