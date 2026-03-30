import type { ToolContent } from "../tools/types.js";

export interface McpRemoteTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: ToolContent[];
  isError: boolean;
}

export interface StdioMcpClientOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  onClose?: (error?: Error) => void;
  onToolsListChanged?: () => void;
}

export interface StdioMcpClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(signal?: AbortSignal): Promise<McpRemoteTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpToolCallResult>;
}

export interface McpToolBinding {
  id: string;
  server_id: string;
  server_name: string;
  server_slug: string;
  remote_name: string;
  local_name: string;
  summary: string | null;
  input_schema: Record<string, unknown>;
}
