import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import type { McpServerRequestPayload } from "@/lib/mcp-form";
import { request } from "./core/client";

export function fetchMcpServers(): Promise<McpServerInfo[]> {
  return request<McpServerInfo[]>("/api/mcp/servers");
}

export function createMcpServer(payload: McpServerRequestPayload): Promise<McpServerInfo> {
  return request<McpServerInfo>("/api/mcp/servers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMcpServer(
  id: string,
  payload: McpServerRequestPayload,
): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function refreshMcpServer(id: string): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}/refresh`, {
    method: "POST",
    body: "{}",
  });
}

export function enableMcpServer(id: string): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableMcpServer(id: string): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}/disable`, {
    method: "POST",
    body: "{}",
  });
}

export function deleteMcpServer(id: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fetchMcpTools(): Promise<McpToolInfo[]> {
  return request<McpToolInfo[]>("/api/mcp/tools");
}

export function enableMcpTool(id: string): Promise<McpToolInfo> {
  return request<McpToolInfo>(`/api/mcp/tools/${encodeURIComponent(id)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableMcpTool(id: string): Promise<McpToolInfo> {
  return request<McpToolInfo>(`/api/mcp/tools/${encodeURIComponent(id)}/disable`, {
    method: "POST",
    body: "{}",
  });
}
