import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import { useMcp } from "../../hooks/useMcp.js";
import {
  parseMcpServerJsonText,
  stringifyMcpServerJsonDocument,
  TAPD_MCP_JSON_EXAMPLE,
} from "../../lib/mcp-form.js";
import type { EditorState } from "./types.js";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [serverBusyId, setServerBusyId] = useState<string | null>(null);
  const [toolBusyId, setToolBusyId] = useState<string | null>(null);
  const [editorBusy, setEditorBusy] = useState(false);
  const [filterServerId, setFilterServerId] = useState<string | null>(null);
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
    if (!normalizedServerQuery) {
      return servers;
    }

    return servers.filter((server) =>
      [server.name, server.slug, server.command, server.transport, statusLabel(server.status)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedServerQuery),
    );
  }, [normalizedServerQuery, servers]);

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
  const enabledToolCount = tools.filter((tool) => tool.enabled).length;
  const filterServer = filterServerId
    ? (servers.find((s) => s.id === filterServerId) ?? null)
    : null;

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

  function resetMessages() {
    setNotice(null);
    setMutationError(null);
  }

  async function handleRefreshList() {
    resetMessages();
    refresh();
  }

  async function handleServerAction(server: McpServerInfo, action: () => Promise<unknown>) {
    setServerBusyId(server.id);
    resetMessages();

    try {
      await action();
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setServerBusyId(null);
    }
  }

  async function handleToolToggle(tool: McpToolInfo) {
    setToolBusyId(tool.id);
    resetMessages();

    try {
      const result = tool.enabled ? await disableTool(tool.id) : await enableTool(tool.id);
      setNotice(`${result.local_name} 已${result.enabled ? "启用" : "停用"}`);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setToolBusyId(null);
    }
  }

  async function handleEditorSubmit() {
    setEditorBusy(true);
    resetMessages();
    setEditorError(null);

    try {
      const parsed = parseMcpServerJsonText(editorText);

      if (editorState?.mode === "edit" && editorServer) {
        const updated = await updateServer(editorServer.id, parsed.document);
        setNotice(`${updated.name} 已保存并刷新`);
        setActiveServerId(updated.id);
      } else {
        const created = await createServer(parsed.document);
        setNotice(`${created.name} 已创建`);
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
    if (!window.confirm(`确认删除 ${server.name} 吗？`)) {
      return;
    }

    await handleServerAction(server, async () => {
      await deleteServer(server.id);
      if (activeServerId === server.id) {
        setActiveServerId(null);
      }
      if (editorState?.mode === "edit" && editorState.serverId === server.id) {
        setEditorState(null);
      }
      setNotice(`${server.name} 已删除`);
    });
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
    notice,
    setNotice,
    mutationError,
    setMutationError,
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
    filterServer,
    handleRefreshList,
    handleServerAction,
    handleToolToggle,
    handleEditorSubmit,
    handleDeleteServer,
  };
}
