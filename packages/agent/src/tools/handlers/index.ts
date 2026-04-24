import type { NativeHandler } from "../types.js";
import { cliHandler } from "./cli.js";
import { webFetchHandler } from "./web-fetch.js";
import { webSearchHandler } from "./web-search.js";

const HANDLER_ALLOWLIST: Record<string, NativeHandler> = {
  "web-fetch": webFetchHandler,
  "web-search": webSearchHandler,
  cli: cliHandler,
};

export function getNativeHandler(name: string): NativeHandler | undefined {
  // Markdown tool 只能引用这里登记的 handler；新增执行能力必须显式进 allowlist。
  return HANDLER_ALLOWLIST[name];
}
