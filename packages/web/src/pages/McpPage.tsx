import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  ActivityIcon,
  LinkIcon,
  PencilIcon,
  SearchIcon,
  TerminalIcon,
  XIcon,
} from "../components/ui/icons.js";
import { Input } from "../components/ui/input.js";
import { useMcp } from "../hooks/useMcp.js";
import { cn } from "../lib/cn.js";
import {
  parseMcpServerJsonText,
  stringifyMcpServerJsonDocument,
  TAPD_MCP_JSON_EXAMPLE,
} from "../lib/mcp-form.js";
import { formatCount, formatDateTime, formatRelativeTime } from "../lib/format.js";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; serverId: string }
  | null;

function statusTone(status: McpServerInfo["status"]): "online" | "offline" | "muted" {
  if (status === "connected") {
    return "online";
  }

  if (status === "disconnected") {
    return "offline";
  }

  return "muted";
}

function statusLabel(status: McpServerInfo["status"]) {
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

function ServerAvatar(props: { status: McpServerInfo["status"] }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-[14px] border bg-[rgba(247,250,251,0.92)]",
        props.status === "connected"
          ? "border-[rgba(21,110,99,0.14)] text-[var(--accent-strong)]"
          : "border-[var(--line)] text-[var(--ink)]"
      )}
    >
      <LinkIcon className="size-[18px]" />
    </span>
  );
}

function ToggleButton(props: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={props.busy}
      aria-pressed={props.enabled}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void props.onToggle();
      }}
      className={cn(
        "relative inline-flex h-8 w-[50px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:cursor-not-allowed disabled:opacity-60",
        props.enabled
          ? "border-[rgba(21,110,99,0.14)] bg-[var(--accent)]"
          : "border-[var(--line-strong)] bg-[rgba(148,163,184,0.38)]"
      )}
    >
      <span
        className={cn(
          "size-6 rounded-full bg-white shadow-[0_8px_18px_-10px_rgba(15,23,42,0.45)] transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
          props.enabled ? "translate-x-[18px]" : "translate-x-0"
        )}
      />
    </button>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">{props.label}</p>
      <p className="mt-1.5 text-[13px] font-medium text-[var(--ink)]">{props.value}</p>
    </div>
  );
}

function ConfigBlock(props: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
            {props.label}
          </p>
        </div>
      </div>
      <pre className="mt-3 overflow-auto rounded-[18px] border border-[var(--line)] bg-[rgba(255,255,255,0.94)] px-4 py-3 text-[11px] leading-6 text-[var(--ink-soft)]">
        {props.value || "暂无配置"}
      </pre>
    </div>
  );
}

function ServerCard(props: {
  server: McpServerInfo;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`查看 ${props.server.name} 详情`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className="reveal-up group flex min-h-[120px] cursor-pointer items-center gap-3 rounded-[24px] border border-[rgba(21,32,43,0.08)] bg-[rgba(255,255,255,0.88)] px-3.5 py-3.5 transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[rgba(21,110,99,0.14)] hover:bg-[rgba(255,255,255,0.96)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(21,110,99,0.14)] md:px-4"
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <ServerAvatar status={props.server.status} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] font-semibold tracking-[-0.03em] text-[var(--ink)]">
            {props.server.name}
          </h3>
          <Badge tone={statusTone(props.server.status)}>{statusLabel(props.server.status)}</Badge>
          <Badge tone="muted">{props.server.slug}</Badge>
        </div>

        <p className="mt-1 truncate text-[12px] leading-5 text-[var(--muted-strong)]">
          {props.server.command}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--muted)]">
          <span>{props.server.transport}</span>
          <span className="size-1 rounded-full bg-[var(--line-strong)]" />
          <span>tools {formatCount(props.server.tool_count)}</span>
          <span className="size-1 rounded-full bg-[var(--line-strong)]" />
          <span>{formatRelativeTime(props.server.last_seen_at)}</span>
        </div>

        {props.server.last_error ? (
          <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-red-600">
            {props.server.last_error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <ToggleButton enabled={props.server.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-[10px] font-medium text-[var(--muted)]">
          {props.server.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}

function McpToolCard(props: {
  tool: McpToolInfo;
  busy: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <div className="flex min-h-[108px] items-center gap-3 rounded-[24px] border border-[rgba(21,32,43,0.08)] bg-[rgba(255,255,255,0.88)] px-3.5 py-3.5 md:px-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] border border-[var(--line)] bg-[rgba(247,250,251,0.92)] text-[var(--ink)]">
        <TerminalIcon className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-[var(--font-mono)] text-[12px] text-[var(--ink)]">
            {props.tool.local_name}
          </h3>
          <Badge tone="muted">{props.tool.server_slug}</Badge>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-[var(--muted-strong)]">
          {props.tool.remote_name}
        </p>
        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-[var(--muted)]">
          {props.tool.summary ?? "该 tool 未提供描述。"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <ToggleButton enabled={props.tool.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-[10px] font-medium text-[var(--muted)]">
          {props.tool.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}

function ServerDetailModal(props: {
  server: McpServerInfo;
  tools: McpToolInfo[];
  serverBusy: boolean;
  busyToolId: string | null;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onEdit: () => void;
  onToggleServer: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onToggleTool: (tool: McpToolInfo) => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭 MCP server 详情"
        onClick={props.onClose}
        className="absolute inset-0 bg-[rgba(15,23,42,0.24)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-server-detail-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <ServerAvatar status={props.server.status} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                  MCP Server Detail
                </p>
                <h3
                  id="mcp-server-detail-title"
                  className="mt-1.5 truncate text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]"
                >
                  {props.server.name}
                </h3>
                <p className="mt-2 text-[13px] leading-6 text-[var(--muted-strong)]">
                  {props.server.command}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(props.server.status)}>{statusLabel(props.server.status)}</Badge>
            <Badge tone="muted">{props.server.slug}</Badge>
            <Badge tone="muted">{props.server.transport}</Badge>
            <Badge tone="muted">tools {formatCount(props.server.tool_count)}</Badge>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={props.serverBusy} onClick={() => void props.onRefresh()}>
              <ActivityIcon className="size-4" />
              刷新目录
            </Button>
            <Button size="sm" variant="outline" onClick={props.onEdit}>
              <PencilIcon className="size-4" />
              编辑配置
            </Button>
            <Button size="sm" variant={props.server.enabled ? "outline" : "primary"} disabled={props.serverBusy} onClick={() => void props.onToggleServer()}>
              {props.server.enabled ? "停用 Server" : "启用 Server"}
            </Button>
            <Button size="sm" variant="ghost" disabled={props.serverBusy} onClick={() => void props.onDelete()}>
              删除配置
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6">
          <div className="grid gap-3 md:grid-cols-2">
            <DetailItem label="Status" value={statusLabel(props.server.status)} />
            <DetailItem label="Last Seen" value={formatDateTime(props.server.last_seen_at)} />
            <DetailItem label="Working Dir" value={props.server.cwd ?? "跟随服务进程"} />
            <DetailItem label="Tool Count" value={formatCount(props.server.tool_count)} />
          </div>

          {props.server.last_error ? (
            <div className="rounded-[22px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-4">
              <p className="text-[10px] uppercase tracking-[0.22em] text-red-600">Last Error</p>
              <p className="mt-2 text-[12px] leading-6 text-red-700">{props.server.last_error}</p>
            </div>
          ) : null}

          <ConfigBlock
            label="Standard JSON"
            value={stringifyMcpServerJsonDocument(props.server)}
          />

          <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  Discovered Tools
                </p>
              </div>
              <Badge tone="muted">{formatCount(props.tools.length)} items</Badge>
            </div>

            <div className="mt-4 space-y-3">
              {props.tools.length > 0 ? (
                props.tools.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-center gap-3 rounded-[18px] border border-[var(--line)] bg-white/86 px-3.5 py-3"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[14px] border border-[var(--line)] bg-[rgba(247,250,251,0.92)] text-[var(--ink)]">
                      <TerminalIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-[var(--font-mono)] text-[11px] text-[var(--ink)]">
                        {tool.local_name}
                      </p>
                      <p className="mt-1 truncate text-[12px] text-[var(--muted-strong)]">
                        {tool.remote_name}
                      </p>
                    </div>
                    <ToggleButton
                      enabled={tool.enabled}
                      busy={props.busyToolId === tool.id}
                      onToggle={() => props.onToggleTool(tool)}
                    />
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] border border-dashed border-[var(--line)] bg-white/60 px-4 py-6 text-center text-[12px] text-[var(--muted)]">
                  暂无 MCP tool
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ServerEditorModal(props: {
  mode: "create" | "edit";
  jsonText: string;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onChange: (value: string) => void;
  onFillExample: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭 MCP server 编辑器"
        onClick={props.onClose}
        className="absolute inset-0 bg-[rgba(15,23,42,0.24)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-server-editor-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                {props.mode === "create" ? "Create Server" : "Edit Server"}
              </p>
              <h3
                id="mcp-server-editor-title"
                className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]"
              >
                {props.mode === "create" ? "粘贴标准 MCP JSON" : "编辑 MCP JSON 配置"}
              </h3>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        <form
          className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onSubmit();
          }}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                MCP JSON
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={props.onFillExample}>
                  填入 TAPD 示例
                </Button>
              </div>
            </div>

            <textarea
              value={props.jsonText}
              onChange={(event) => props.onChange(event.target.value)}
              spellCheck={false}
              placeholder={TAPD_MCP_JSON_EXAMPLE}
              className="min-h-[320px] w-full rounded-[18px] border border-[var(--line-strong)] bg-[rgba(255,255,255,0.82)] px-4 py-3 font-[var(--font-mono)] text-[12px] leading-6 text-[var(--ink)] outline-none transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-[3px] focus:ring-[rgba(21,110,99,0.14)]"
            />

            {props.error ? (
              <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
                {props.error}
              </div>
            ) : null}

            <ConfigBlock
              label="输入案例"
              value={TAPD_MCP_JSON_EXAMPLE}
            />
          </div>

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-[var(--line)] bg-[rgba(255,255,255,0.92)] px-1 pt-4">
            <Button type="button" variant="outline" onClick={props.onClose}>
              取消
            </Button>
            <Button disabled={props.busy} type="submit">
              {props.mode === "create" ? "创建并连接" : "保存并刷新"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function McpPage() {
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
  const deferredServerQuery = useDeferredValue(serverQuery);
  const deferredToolQuery = useDeferredValue(toolQuery);
  const normalizedServerQuery = deferredServerQuery.trim().toLowerCase();
  const normalizedToolQuery = deferredToolQuery.trim().toLowerCase();
  const activeServer = servers.find((server) => server.id === activeServerId) ?? null;
  const editorServer =
    editorState?.mode === "edit"
      ? servers.find((server) => server.id === editorState.serverId) ?? null
      : null;

  const filteredServers = useMemo(() => {
    if (!normalizedServerQuery) {
      return servers;
    }

    return servers.filter((server) =>
      [server.name, server.slug, server.command, server.transport, statusLabel(server.status)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedServerQuery)
    );
  }, [normalizedServerQuery, servers]);

  const filteredTools = useMemo(() => {
    if (!normalizedToolQuery) {
      return tools;
    }

    return tools.filter((tool) =>
      [tool.local_name, tool.remote_name, tool.server_name, tool.server_slug, tool.summary ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(normalizedToolQuery)
    );
  }, [normalizedToolQuery, tools]);

  const activeServerTools = activeServer
    ? tools.filter((tool) => tool.server_id === activeServer.id)
    : [];
  const connectedCount = servers.filter((server) => server.status === "connected").length;
  const enabledServerCount = servers.filter((server) => server.enabled).length;
  const enabledToolCount = tools.filter((tool) => tool.enabled).length;

  useEffect(() => {
    if (activeServerId && !servers.some((server) => server.id === activeServerId)) {
      setActiveServerId(null);
    }
  }, [activeServerId, servers]);

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

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                MCP Servers
              </p>
              <h2 className="mt-1.5 text-[24px] text-[var(--ink)]">远端 tools 接入中心</h2>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void handleRefreshList()}>
                <ActivityIcon className="size-4" />
                刷新列表
              </Button>
              <Button
                size="sm"
                onClick={() => startTransition(() => setEditorState({ mode: "create" }))}
              >
                新建配置
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                value={serverQuery}
                onChange={(event) => setServerQuery(event.target.value)}
                placeholder="搜索 server 名称、slug、命令或状态"
                className="h-10 rounded-[14px] pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
              <Badge tone="muted">配置 {formatCount(servers.length)}</Badge>
              <Badge tone="muted">已启用 {formatCount(enabledServerCount)}</Badge>
              <Badge tone="muted">已连接 {formatCount(connectedCount)}</Badge>
              <Badge tone="muted">发现 tools {formatCount(tools.length)}</Badge>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
            加载 MCP 列表失败：{error}
          </div>
        ) : null}

        {mutationError ? (
          <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
            操作失败：{mutationError}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-[18px] border border-[rgba(21,110,99,0.14)] bg-[rgba(240,253,250,0.92)] px-4 py-3 text-[12px] leading-6 text-[var(--accent-strong)]">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[rgba(255,255,255,0.8)] px-3.5 py-3.5 md:px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="ui-skeleton size-10 rounded-[14px]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ui-skeleton h-5 rounded-[8px]" />
                    <div className="ui-skeleton h-4 rounded-[8px]" />
                    <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                  </div>
                  <div className="ui-skeleton h-8 w-[50px] rounded-full" />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {!loading && filteredServers.length === 0 ? (
          <section className="rounded-[28px] border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.48)] px-5 py-10 text-center">
            <p className="text-[15px] font-medium text-[var(--ink)]">
              {servers.length === 0 ? "还没有 MCP 配置" : "没有匹配到 MCP server"}
            </p>
          </section>
        ) : null}

        {!loading && filteredServers.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <LinkIcon className="size-4 text-[var(--muted-strong)]" />
              <span>当前展示 {formatCount(filteredServers.length)} 个 MCP server</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {filteredServers.map((server, index) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  index={index}
                  busy={serverBusyId === server.id}
                  onOpen={() => startTransition(() => setActiveServerId(server.id))}
                  onToggle={() =>
                    handleServerAction(server, async () => {
                      const result = server.enabled
                        ? await disableServer(server.id)
                        : await enableServer(server.id);
                      setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
                    })
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-3 border-t border-[var(--line)] pt-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                Discovered Tools
              </p>
              <h3 className="mt-1.5 text-[22px] text-[var(--ink)]">MCP tools 目录</h3>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="relative w-full xl:w-[320px]">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
                <Input
                  value={toolQuery}
                  onChange={(event) => setToolQuery(event.target.value)}
                  placeholder="搜索 local name / remote name / server"
                  className="h-10 rounded-[14px] pl-10"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
                <Badge tone="muted">已发现 {formatCount(tools.length)}</Badge>
                <Badge tone="muted">已启用 {formatCount(enabledToolCount)}</Badge>
              </div>
            </div>
          </div>

          {!loading && filteredTools.length === 0 ? (
            <section className="rounded-[24px] border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.48)] px-5 py-8 text-center">
              <p className="text-[14px] font-medium text-[var(--ink)]">没有匹配到 MCP tool</p>
            </section>
          ) : null}

          {filteredTools.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredTools.map((tool) => (
                <McpToolCard
                  key={tool.id}
                  tool={tool}
                  busy={toolBusyId === tool.id}
                  onToggle={() => handleToolToggle(tool)}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {activeServer && !editorState ? (
        <ServerDetailModal
          server={activeServer}
          tools={activeServerTools}
          serverBusy={serverBusyId === activeServer.id}
          busyToolId={toolBusyId}
          onClose={() => setActiveServerId(null)}
          onRefresh={() => handleServerAction(activeServer, () => refreshServer(activeServer.id))}
          onEdit={() => startTransition(() => setEditorState({ mode: "edit", serverId: activeServer.id }))}
          onToggleServer={() =>
            handleServerAction(activeServer, async () => {
              const result = activeServer.enabled
                ? await disableServer(activeServer.id)
                : await enableServer(activeServer.id);
              setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
            })
          }
          onDelete={() => handleDeleteServer(activeServer)}
          onToggleTool={(tool) => handleToolToggle(tool)}
        />
      ) : null}

      {editorState ? (
        <ServerEditorModal
          mode={editorState.mode}
          jsonText={editorText}
          error={editorError}
          busy={editorBusy}
          onClose={() => setEditorState(null)}
          onChange={(value) => {
            setEditorText(value);
            setEditorError(null);
          }}
          onFillExample={() => {
            setEditorText(TAPD_MCP_JSON_EXAMPLE);
            setEditorError(null);
          }}
          onSubmit={() => handleEditorSubmit()}
        />
      ) : null}
    </>
  );
}
