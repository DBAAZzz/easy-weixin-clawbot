import type { NativeHandler } from "../types.js";
import { cliHandler } from "./cli.js";
import { webSearchHandler } from "./web-search.js";

const HANDLER_ALLOWLIST: Record<string, NativeHandler> = {
  "web-search": webSearchHandler,
  cli: cliHandler,
};

export function getNativeHandler(name: string): NativeHandler | undefined {
  return HANDLER_ALLOWLIST[name];
}
