import type { Command } from "./types.js";
import { resetCommand } from "./reset.js";
import { echoCommand } from "./echo.js";
import { createDebugCommand, type DebugFlags } from "./debug.js";
import { helpCommand } from "./help.js";

export function createBuiltinCommands(deps: { debugFlags: DebugFlags }): Command[] {
  return [
    resetCommand,
    echoCommand,
    createDebugCommand(deps.debugFlags),
    helpCommand,
  ];
}
