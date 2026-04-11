import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import {
  createMcpServer,
  deleteMcpServer,
  disableMcpServer,
  disableMcpTool,
  enableMcpServer,
  enableMcpTool,
  fetchMcpServers,
  fetchMcpTools,
  refreshMcpServer,
  updateMcpServer,
} from "../lib/api.js";
import type { McpServerRequestPayload } from "../lib/mcp-form.js";
import { queryKeys } from "../lib/query-keys.js";

export function useMcp() {
  const queryClient = useQueryClient();

  const serversQuery = useQuery({
    queryKey: queryKeys.mcpServers,
    queryFn: fetchMcpServers,
  });

  const toolsQuery = useQuery({
    queryKey: queryKeys.mcpTools,
    queryFn: fetchMcpTools,
  });

  const loading = serversQuery.isPending || toolsQuery.isPending;
  const rawError = serversQuery.error || toolsQuery.error;

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers });
    void queryClient.invalidateQueries({ queryKey: queryKeys.mcpTools });
  }

  return {
    servers: serversQuery.data ?? ([] as McpServerInfo[]),
    tools: toolsQuery.data ?? ([] as McpToolInfo[]),
    loading,
    error: rawError instanceof Error ? rawError.message : rawError ? String(rawError) : null,
    async createServer(input: McpServerRequestPayload) {
      const result = await createMcpServer(input);
      invalidateAll();
      return result;
    },
    async updateServer(id: string, input: McpServerRequestPayload) {
      const result = await updateMcpServer(id, input);
      invalidateAll();
      return result;
    },
    async refreshServer(id: string) {
      const result = await refreshMcpServer(id);
      invalidateAll();
      return result;
    },
    async enableServer(id: string) {
      const result = await enableMcpServer(id);
      invalidateAll();
      return result;
    },
    async disableServer(id: string) {
      const result = await disableMcpServer(id);
      invalidateAll();
      return result;
    },
    async deleteServer(id: string) {
      const result = await deleteMcpServer(id);
      invalidateAll();
      return result;
    },
    async enableTool(id: string) {
      const result = await enableMcpTool(id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpTools });
      return result;
    },
    async disableTool(id: string) {
      const result = await disableMcpTool(id);
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpTools });
      return result;
    },
    refresh: invalidateAll,
  };
}
