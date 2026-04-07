import type { Command } from "./types.js";

export const helpCommand: Command = {
  name: "help",
  description: "列出所有可用命令",
  async execute(ctx) {
    const lines = ctx.commands.map((cmd) => `/${cmd.name} — ${cmd.description}`);
    return { text: lines.join("\n") };
  },
};
