import type { Command } from "./types.js";
import { resetCommand } from "./reset.js";
import { echoCommand } from "./echo.js";
import { debugCommand } from "./debug.js";
import { helpCommand } from "./help.js";

export const builtinCommands: Command[] = [
  resetCommand,
  echoCommand,
  debugCommand,
  helpCommand,
];
