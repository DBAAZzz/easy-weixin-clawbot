import type { McpServerInfo } from "@clawbot/shared";

export type EditorState = { mode: "create" } | { mode: "edit"; serverId: string } | null;

export type ServerDetailTab = "config" | "tools";

export function statusTone(status: McpServerInfo["status"]): "online" | "offline" | "muted" {
  if (status === "connected") {
    return "online";
  }

  if (status === "disconnected") {
    return "offline";
  }

  return "muted";
}

export function statusLabel(status: McpServerInfo["status"]) {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "error":
      return "异常";
    case "disconnected":
    default:
      return "已断开";
  }
}
