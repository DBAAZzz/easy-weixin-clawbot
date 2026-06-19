import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import { toast } from "@clawbot/ui";
import { useMcp } from "@/hooks/useMcp.js";
import { formatCount, formatPercent } from "@/lib/format.js";
import {
  parseMcpServerJsonText,
  stringifyMcpServerJsonDocument,
  TAPD_MCP_JSON_EXAMPLE,
} from "@/lib/mcp-form.js";
import type { EditorState, McpStat } from "./types.js";
import { statusLabel } from "./types.js";

export function useMcpPage() {
  const {
    servers,
    tools,
    loading,
    error,
    createServer,
    updateServer,
    refreshServer,
    enableServer,
    disableServer,
    deleteServer,
    enableTool,
    disableTool,
    refresh,
  } = useMcp();
  const [serverQuery, setServerQuery] = useState("");
  const [toolQuery, setToolQuery] = useState("");
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState>(null);
  const [editorText, setEditorText] = useState(TAPD_MCP_JSON_EXAMPLE);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [serverBusyId, setServerBusyId] = useState<string | null>(null);
  const [toolBusyId, setToolBusyId] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [filterServerId, setFilterServerId] = useState<string | null>(null);
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [expandedServerIds, setExpandedServerIds] = useState<Record<string, boolean>>({});
  const [deleteConfirmServer, setDeleteConfirmServer] = useState<McpServerInfo | null>(null);
  const deferredServerQuery = useDeferredValue(serverQuery);
  const deferredToolQuery = useDeferredValue(toolQuery);
  const normalizedServerQuery = deferredServerQuery.trim().toLowerCase();
  const normalizedToolQuery = deferredToolQuery.trim().toLowerCase();
  const activeServer = servers.find((server) => server.id === activeServerId) ?? null;
  const editorServer =
    editorState?.mode === "edit"
      ? (servers.find((server) => server.id === editorState.serverId) ?? null)
      : null;

  const filteredServers = useMemo(() => {
    return servers.filter((server) => {
      if (onlyEnabled && !server.enabled) {
        return false;
      }

      if (!normalizedServerQuery) {
        return true;
      }

      const serverText = [
        server.name,
        server.slug,
        server.command,
        server.transport,
        statusLabel(server.status),
      ]
        .join(" ")
        .toLowerCase();

      if (serverText.includes(normalizedServerQuery)) {
        return true;
      }

      return tools.some(
        (tool) =>
          tool.server_id === server.id &&
          [
            tool.local_name,
            tool.remote_name,
            tool.server_name,
            tool.server_slug,
            tool.summary ?? "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedServerQuery),
      );
    });
  }, [normalizedServerQuery, onlyEnabled, servers, tools]);

  const filteredTools = useMemo(() => {
    let result = filterServerId ? tools.filter((t) => t.server_id === filterServerId) : tools;
    if (normalizedToolQuery) {
      result = result.filter((tool) =>
        [tool.local_name, tool.remote_name, tool.server_name, tool.server_slug, tool.summary ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(normalizedToolQuery),
      );
    }
    return result;
  }, [normalizedToolQuery, tools, filterServerId]);

  const activeServerTools = activeServer
    ? tools.filter((tool) => tool.server_id === activeServer.id)
    : [];
  const connectedCount = servers.filter((server) => server.status === "connected").length;
  const enabledServerCount = servers.filter((server) => server.enabled).length;
  const disabledServerCount = servers.length - enabledServerCount;
  const enabledToolCount = tools.filter((tool) => tool.enabled).length;
  const allVisibleExpanded =
    filteredServers.length > 0 && filteredServers.every((server) => expandedServerIds[server.id]);
  const filterServer = filterServerId
    ? (servers.find((s) => s.id === filterServerId) ?? null)
    : null;

  const stats: McpStat[] = [
    {
      label: "服务器总数",
      value: formatCount(servers.length),
      meta: "已配置",
      dotClassName: "bg-account-ink",
      valueClassName: "text-account-ink",
    },
    {
      label: "已启用",
      value: formatCount(enabledServerCount),
      meta:
        servers.length > 0
          ? `占比 ${formatPercent(enabledServerCount / servers.length)}`
          : "占比 0%",
      dotClassName: "bg-account-success-dot",
      valueClassName: "text-account-success-fg",
    },
    {
      label: "已停用",
      value: formatCount(disabledServerCount),
      meta: "未运行",
      dotClassName: "bg-account-muted-faint",
      valueClassName: "text-account-muted",
    },
    {
      label: "可用工具",
      value: formatCount(enabledToolCount),
      meta: `${formatCount(tools.length)} 个已发现`,
      dotClassName: "bg-account-warning-dot",
      valueClassName: "text-account-ink",
    },
  ];

  useEffect(() => {
    if (activeServerId && !servers.some((server) => server.id === activeServerId)) {
      setActiveServerId(null);
    }
  }, [activeServerId, servers]);

  useEffect(() => {
    if (filterServerId && !servers.some((server) => server.id === filterServerId)) {
      setFilterServerId(null);
    }
  }, [filterServerId, servers]);

  useEffect(() => {
    if (editorState?.mode === "edit" && !editorServer) {
      setEditorState(null);
    }
  }, [editorServer, editorState]);

  useEffect(() => {
    if (!editorState) {
      return;
    }

    if (editorState.mode === "create") {
      setEditorText(TAPD_MCP_JSON_EXAMPLE);
      setEditorError(null);
      return;
    }

    if (editorServer) {
      setEditorText(stringifyMcpServerJsonDocument(editorServer));
      setEditorError(null);
    }
  }, [editorServer, editorState]);

  useEffect(() => {
    if (!activeServer && !editorState) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (editorState) {
        setEditorState(null);
        return;
      }

      setActiveServerId(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeServer, editorState]);

  async function handleRefreshList() {
    refresh();
  }

  async function handleServerAction(server: McpServerInfo, action: () => Promise<unknown>) {
    setServerBusyId(server.id);

    try {
      await action();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setServerBusyId(null);
    }
  }

  async function handleToolToggle(tool: McpToolInfo) {
    setToolBusyId(tool.id);

    try {
      const result = tool.enabled ? await disableTool(tool.id) : await enableTool(tool.id);
      toast.success(`${result.local_name} 已${result.enabled ? "启用" : "停用"}`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "更新失败");
    } finally {
      setToolBusyId(null);
    }
  }

  function toggleServerExpanded(serverId: string) {
    setExpandedServerIds((current) => ({
      ...current,
      [serverId]: !current[serverId],
    }));
  }

  function setAllVisibleExpanded(expanded: boolean) {
    setExpandedServerIds((current) => {
      const next = { ...current };
      for (const server of filteredServers) {
        next[server.id] = expanded;
      }
      return next;
    });
  }

  async function handleEditorSubmit() {
    setEditorBusy(true);
    setEditorError(null);

    try {
      const parsed = parseMcpServerJsonText(editorText);

      if (editorState?.mode === "edit" && editorServer) {
        const updated = await updateServer(editorServer.id, parsed.document);
        toast.success(`${updated.name} 已保存并刷新`);
        setActiveServerId(updated.id);
      } else {
        const created = await createServer(parsed.document);
        toast.success(`${created.name} 已创建`);
        setActiveServerId(created.id);
      }

      setEditorState(null);
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEditorBusy(false);
    }
  }

  async function handleDeleteServer(server: McpServerInfo) {
    setDeleteConfirmServer(server);
  }

  function cancelDeleteServer() {
    if (deleteConfirmServer && serverBusyId === deleteConfirmServer.id) {
      return;
    }

    setDeleteConfirmServer(null);
  }

  async function confirmDeleteServer() {
    if (!deleteConfirmServer) {
      return;
    }

    const server = deleteConfirmServer;
    setServerBusyId(server.id);

    try {
      await deleteServer(server.id);

      if (activeServerId === server.id) {
        setActiveServerId(null);
      }

      if (editorState?.mode === "edit" && editorState.serverId === server.id) {
        setEditorState(null);
      }

      setDeleteConfirmServer(null);
      toast.success(`${server.name} 已删除`);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setServerBusyId(null);
    }
  }

  return {
    servers,
    tools,
    loading,
    error,
    refresh,
    refreshServer,
    createServer,
    updateServer,
    enableServer,
    disableServer,
    deleteServer,
    serverQuery,
    setServerQuery,
    toolQuery,
    setToolQuery,
    activeServerId,
    setActiveServerId,
    editorState,
    setEditorState,
    editorText,
    setEditorText,
    editorError,
    setEditorError,
    serverBusyId,
    toolBusyId,
    editorBusy,
    filterServerId,
    setFilterServerId,
    filteredServers,
    filteredTools,
    activeServer,
    activeServerTools,
    connectedCount,
    enabledToolCount,
    enabledServerCount,
    disabledServerCount,
    stats,
    filterServer,
    onlyEnabled,
    setOnlyEnabled,
    expandedServerIds,
    deleteConfirmServer,
    allVisibleExpanded,
    toggleServerExpanded,
    setAllVisibleExpanded,
    cancelDeleteServer,
    confirmDeleteServer,
    handleRefreshList,
    handleServerAction,
    handleToolToggle,
    handleEditorSubmit,
    handleDeleteServer,
  };
}
