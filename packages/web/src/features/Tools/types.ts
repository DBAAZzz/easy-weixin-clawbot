import type { ToolInfo } from "@clawbot/shared";

export function formatOriginLabel(origin: ToolInfo["origin"]) {
  return origin === "builtin" ? "代码内置" : origin;
}
