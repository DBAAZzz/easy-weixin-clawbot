import type { Command } from "./types.js";

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(cmd: Command): void {
    this.commands.set(cmd.name, cmd);
  }

  registerAll(cmds: Command[]): void {
    for (const cmd of cmds) this.register(cmd);
  }

  /** 只读快照，注入到 CommandContext.commands */
  list(): ReadonlyArray<Pick<Command, "name" | "description">> {
    return [...this.commands.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }

  tryDispatch(text: string): { command: Command; args: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;

    const spaceIdx = trimmed.indexOf(" ");
    const name = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
    const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

    const cmd = this.commands.get(name);
    return cmd ? { command: cmd, args } : null;
  }
}
