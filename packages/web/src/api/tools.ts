import type { ToolInfo, MarkdownSource } from "@clawbot/shared";
import { request } from "./core/client";

export function fetchTools(): Promise<ToolInfo[]> {
  return request<ToolInfo[]>("/api/tools");
}

export function fetchToolSource(name: string): Promise<MarkdownSource> {
  return request<MarkdownSource>(`/api/tools/${encodeURIComponent(name)}/source`);
}

export function installTool(markdown: string): Promise<ToolInfo> {
  return request<ToolInfo>("/api/tools", {
    method: "POST",
    body: JSON.stringify({ markdown }),
  });
}

export function updateTool(name: string, markdown: string): Promise<ToolInfo> {
  return request<ToolInfo>(`/api/tools/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ markdown }),
  });
}

export function enableTool(name: string): Promise<ToolInfo> {
  return request<ToolInfo>(`/api/tools/${encodeURIComponent(name)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableTool(name: string): Promise<ToolInfo> {
  return request<ToolInfo>(`/api/tools/${encodeURIComponent(name)}/disable`, {
    method: "POST",
    body: "{}",
  });
}

export function removeTool(name: string): Promise<{ name: string }> {
  return request<{ name: string }>(`/api/tools/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}
