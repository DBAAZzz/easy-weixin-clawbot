import type { ToolInfo } from "@clawbot/shared";
import { request } from "./core/client";

export function fetchTools(): Promise<ToolInfo[]> {
  return request<ToolInfo[]>("/api/tools");
}
