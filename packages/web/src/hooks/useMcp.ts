import { useState } from "react";
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
import { useAsyncResource } from "./use-async-resource.js";

export function useMcp() {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource(async () => {
    const [servers, tools] = await Promise.all([fetchMcpServers(), fetchMcpTools()]);
    return { servers, tools };
  }, [revision]);

  function refresh() {
    setRevision((value) => value + 1);
  }

  return {
    servers: resource.data?.servers ?? ([] as McpServerInfo[]),
    tools: resource.data?.tools ?? ([] as McpToolInfo[]),
    loading: resource.loading,
    error: resource.error,
    async createServer(input: McpServerRequestPayload) {
      const result = await createMcpServer(input);
      refresh();
      return result;
    },
    async updateServer(id: string, input: McpServerRequestPayload) {
      const result = await updateMcpServer(id, input);
      refresh();
      return result;
    },
    async refreshServer(id: string) {
      const result = await refreshMcpServer(id);
      refresh();
      return result;
    },
    async enableServer(id: string) {
      const result = await enableMcpServer(id);
      refresh();
      return result;
    },
    async disableServer(id: string) {
      const result = await disableMcpServer(id);
      refresh();
      return result;
    },
    async deleteServer(id: string) {
      const result = await deleteMcpServer(id);
      refresh();
      return result;
    },
    async enableTool(id: string) {
      const result = await enableMcpTool(id);
      refresh();
      return result;
    },
    async disableTool(id: string) {
      const result = await disableMcpTool(id);
      refresh();
      return result;
    },
    refresh,
  };
}
