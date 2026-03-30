import {
  createMcpToolSnapshotItem,
  createStdioMcpClient,
  type McpRemoteTool,
  type StdioMcpClient,
  type ToolRegistry,
} from "@clawbot/agent";
import type { ToolSnapshotItem } from "@clawbot/agent/tools/types";
import type { McpServerInfo, McpToolInfo, McpTransport } from "@clawbot/shared";
import {
  buildMcpLocalToolName,
  createMcpServer,
  deleteMcpServer,
  getMcpServer,
  getMcpServerConfig,
  listEnabledMcpBindings,
  listEnabledMcpServerConfigs,
  listMcpServers,
  listMcpTools,
  setMcpServerEnabled,
  setMcpToolEnabled,
  syncMcpTools,
  updateMcpServer,
  updateMcpServerConnectionState,
  type McpServerRuntimeConfig,
  type McpServerWriteInput,
} from "../db/mcp.js";

type RuntimeEntry = {
  client: StdioMcpClient;
  config: McpServerRuntimeConfig;
};

export interface McpManager {
  bootstrap(): Promise<void>;
  shutdown(): Promise<void>;
  listServers(): Promise<McpServerInfo[]>;
  getServer(id: string): Promise<McpServerInfo | null>;
  createServer(input: McpServerWriteInput): Promise<McpServerInfo>;
  updateServer(id: string, input: Partial<McpServerWriteInput>): Promise<McpServerInfo>;
  deleteServer(id: string): Promise<void>;
  refreshServer(id: string): Promise<McpServerInfo>;
  enableServer(id: string): Promise<McpServerInfo>;
  disableServer(id: string): Promise<McpServerInfo>;
  listTools(): Promise<McpToolInfo[]>;
  enableTool(id: string): Promise<McpToolInfo>;
  disableTool(id: string): Promise<McpToolInfo>;
}

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ensureSupportedTransport(transport: McpTransport): void {
  if (transport !== "stdio") {
    throw new Error(`Unsupported MCP transport: ${transport}`);
  }
}

function normalizeDiscoveredTools(
  server: Pick<McpServerRuntimeConfig, "slug">,
  tools: readonly McpRemoteTool[],
) {
  return tools.map((tool) => ({
    remote_name: tool.name,
    local_name: buildMcpLocalToolName(server.slug, tool.name),
    summary: tool.description?.trim() || null,
    input_schema: tool.inputSchema,
  }));
}

export function createMcpManager(registry: ToolRegistry): McpManager {
  const runtimes = new Map<string, RuntimeEntry>();
  const serverOps = new Map<string, Promise<unknown>>();

  async function rebuildRegistry(): Promise<void> {
    const activeServerIds = [...runtimes.keys()];
    if (activeServerIds.length === 0) {
      registry.swap({ tools: [] });
      return;
    }

    const bindings = await listEnabledMcpBindings(activeServerIds);
    // 二次检查：DB 查询期间 server 可能已断开
    const tools: ToolSnapshotItem[] = [];
    for (const binding of bindings) {
      const runtime = runtimes.get(binding.server_id);
      if (runtime) {
        tools.push(createMcpToolSnapshotItem(binding, runtime.client));
      }
    }

    registry.swap({ tools });
  }

  async function closeRuntime(serverId: string): Promise<void> {
    const runtime = runtimes.get(serverId);
    if (!runtime) {
      return;
    }

    runtimes.delete(serverId);
    await runtime.client.close().catch(() => undefined);
  }

  async function connectServer(server: McpServerRuntimeConfig): Promise<void> {
    ensureSupportedTransport(server.transport);
    await updateMcpServerConnectionState(server.id, {
      status: "connecting",
      last_error: null,
    });

    const client = createStdioMcpClient({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd,
      onClose: (error) => {
        void runServerExclusive(server.id, async () => {
          if (!runtimes.has(server.id)) {
            return;
          }

          runtimes.delete(server.id);
          await updateMcpServerConnectionState(server.id, {
            status: "error",
            last_error: toErrorText(error ?? "MCP server disconnected"),
          });
          await rebuildRegistry();
        }).catch((closeError) => {
          console.error("[mcp] unexpected close handler failed", closeError);
        });
      },
      onToolsListChanged: () => {
        void runServerExclusive(server.id, async () => {
          await refreshServerInternal(server.id);
        }).catch((error) => {
          console.error("[mcp] tool list refresh failed", error);
        });
      },
    });

    try {
      await client.connect();
      const discoveredTools = await client.listTools();
      await syncMcpTools(server.id, normalizeDiscoveredTools(server, discoveredTools));

      runtimes.set(server.id, { client, config: server });
      await updateMcpServerConnectionState(server.id, {
        status: "connected",
        last_error: null,
        last_seen_at: new Date(),
      });
      await rebuildRegistry();
    } catch (error) {
      await client.close().catch(() => undefined);
      await updateMcpServerConnectionState(server.id, {
        status: "error",
        last_error: toErrorText(error),
      });
      throw error;
    }
  }

  async function refreshServerInternal(serverId: string): Promise<McpServerInfo> {
    await closeRuntime(serverId);

    const server = await getMcpServerConfig(serverId);
    if (!server) {
      throw new Error(`MCP server not found: ${serverId}`);
    }

    if (!server.enabled) {
      await updateMcpServerConnectionState(serverId, {
        status: "disconnected",
        last_error: null,
      });
      await rebuildRegistry();
      return requireServer(serverId);
    }

    await connectServer(server);
    return requireServer(serverId);
  }

  function runServerExclusive<T>(serverId: string, operation: () => Promise<T>): Promise<T> {
    const previous = serverOps.get(serverId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const barrier = next.then(
      () => undefined,
      () => undefined,
    );
    serverOps.set(serverId, barrier);
    return next.finally(() => {
      if (serverOps.get(serverId) === barrier) {
        serverOps.delete(serverId);
      }
    });
  }

  async function requireServer(id: string): Promise<McpServerInfo> {
    const server = await getMcpServer(id);
    if (!server) {
      throw new Error(`MCP server not found: ${id}`);
    }
    return server;
  }

  return {
    async bootstrap() {
      const servers = await listEnabledMcpServerConfigs();
      await Promise.all(
        servers.map((server) =>
          runServerExclusive(server.id, () => connectServer(server)).catch((error) => {
            console.warn(`[mcp] bootstrap failed for ${server.slug}: ${toErrorText(error)}`);
          }),
        ),
      );
    },

    async shutdown() {
      registry.swap({ tools: [] });
      for (const serverId of [...runtimes.keys()]) {
        await closeRuntime(serverId);
      }
    },

    listServers() {
      return listMcpServers();
    },

    getServer(id) {
      return getMcpServer(id);
    },

    async createServer(input) {
      ensureSupportedTransport(input.transport);
      const server = await createMcpServer(input);
      await runServerExclusive(server.id, async () => {
        await refreshServerInternal(server.id);
      }).catch(() => undefined);
      return requireServer(server.id);
    },

    async updateServer(id, input) {
      if (input.transport) {
        ensureSupportedTransport(input.transport);
      }
      await updateMcpServer(id, input);
      return runServerExclusive(id, async () => refreshServerInternal(id));
    },

    async deleteServer(id) {
      await runServerExclusive(id, async () => {
        await closeRuntime(id);
        await deleteMcpServer(id);
        await rebuildRegistry();
      });
    },

    async refreshServer(id) {
      return runServerExclusive(id, async () => refreshServerInternal(id));
    },

    async enableServer(id) {
      await setMcpServerEnabled(id, true);
      return runServerExclusive(id, async () => refreshServerInternal(id));
    },

    async disableServer(id) {
      await setMcpServerEnabled(id, false);
      return runServerExclusive(id, async () => {
        await closeRuntime(id);
        await updateMcpServerConnectionState(id, {
          status: "disconnected",
          last_error: null,
        });
        await rebuildRegistry();
        return requireServer(id);
      });
    },

    listTools() {
      return listMcpTools();
    },

    async enableTool(id) {
      const tool = await setMcpToolEnabled(id, true);
      await rebuildRegistry();
      return tool;
    },

    async disableTool(id) {
      const tool = await setMcpToolEnabled(id, false);
      await rebuildRegistry();
      return tool;
    },
  };
}
