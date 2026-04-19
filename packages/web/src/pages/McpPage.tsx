import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  ActivityIcon,
  LinkIcon,
  PuzzleIcon,
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

type EditorState = { mode: "create" } | { mode: "edit"; serverId: string } | null;

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
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-frost-92",
        props.status === "connected"
          ? "border-notice-success-border text-accent-strong"
          : "border-line text-ink",
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
        "relative inline-flex h-8 w-[50px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        props.enabled
          ? "border-notice-success-border bg-accent"
          : "border-line-strong bg-toggle-off-strong",
      )}
    >
      <span
        className={cn(
          "size-6 rounded-full bg-white shadow-float transition duration-200 ease-expo",
          props.enabled ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

type ServerDetailTab = "config" | "tools";

function ExpandableSummary(props: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = props.text.trim();
  const canExpand = summary.length > 60;

  if (!summary) {
    return null;
  }

  return (
    <div className="mt-4 max-w-3xl">
      <p
        className={cn(
          "text-lg leading-7 text-muted-strong",
          canExpand && !expanded && "line-clamp-2",
        )}
      >
        {summary}
      </p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-sm font-medium text-accent-strong transition hover:text-accent"
        >
          {expanded ? "收起" : "...更多"}
        </button>
      ) : null}
    </div>
  );
}

function CompactMetaStrip(props: {
  items: Array<{ label: string; value: string; mono?: boolean }>;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-panel border border-line bg-white/72">
      <dl className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
        {props.items.map((item, index) => (
          <div
            key={item.label}
            className={cn(
              "px-4 py-3.5",
              index > 0 && "border-t border-line",
              index % 2 === 1 && "md:border-l",
              index < 2 && "md:border-t-0",
              index > 0 && "xl:border-l",
              index > 1 && "xl:border-t-0",
            )}
          >
            <dt className="text-xs tracking-label text-muted">{item.label}</dt>
            <dd
              className={cn(
                "mt-1.5 text-md font-medium text-ink",
                item.mono && "font-mono text-sm tracking-mono text-ink-soft",
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function DetailTabButton(props: {
  tab: ServerDetailTab;
  activeTab: ServerDetailTab;
  label: string;
  onSelect: (tab: ServerDetailTab) => void;
}) {
  const selected = props.activeTab === props.tab;

  return (
    <button
      id={`mcp-server-tab-${props.tab}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`mcp-server-panel-${props.tab}`}
      onClick={() => props.onSelect(props.tab)}
      className={cn(
        "inline-flex items-center border-b-2 px-0 pb-3 pt-1 text-base font-medium tracking-body transition duration-200 ease-expo",
        selected ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      <span>{props.label}</span>
    </button>
  );
}

function ServerCard(props: {
  server: McpServerInfo;
  index: number;
  busy: boolean;
  selected: boolean;
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
      className={cn(
        "reveal-up group flex min-h-[120px] cursor-pointer items-center gap-3 rounded-lg border bg-card-bg px-3.5 py-3.5 transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent md:px-4",
        props.selected
          ? "border-accent-selected ring-2 ring-accent-selected-ring"
          : "border-card-line",
      )}
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <ServerAvatar status={props.server.status} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-title text-ink">{props.server.name}</h3>
          <Badge tone={statusTone(props.server.status)}>{statusLabel(props.server.status)}</Badge>
          <Badge tone="muted">{props.server.slug}</Badge>
        </div>

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">
          {props.server.command}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-0.5">
            <TerminalIcon className="size-3" />
            {props.server.transport}
          </span>
          <span className="size-1 rounded-full bg-line-strong" />
          <span className="inline-flex items-center gap-0.5">
            <PuzzleIcon className="size-3" />
            tools {formatCount(props.server.tool_count)}
          </span>
          <span className="size-1 rounded-full bg-line-strong" />
          <span>{formatRelativeTime(props.server.last_seen_at)}</span>
        </div>

        {props.server.last_error ? (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-red-600">
            {props.server.last_error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <ToggleButton enabled={props.server.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-2xs font-medium text-muted">
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
    <div className="flex min-h-[108px] items-center gap-3 rounded-lg border border-card-line bg-card-bg px-3.5 py-3.5 md:px-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-frost-92 text-ink">
        <TerminalIcon className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-md font-medium text-ink">{props.tool.remote_name}</h3>
          <Badge tone="muted">{props.tool.server_slug}</Badge>
        </div>
        <p
          className="mt-1 truncate font-mono text-xs leading-5 text-muted"
          title={props.tool.local_name}
        >
          {props.tool.local_name}
        </p>
        <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-muted-strong">
          {props.tool.summary ?? "该 tool 未提供描述。"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <ToggleButton enabled={props.tool.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-2xs font-medium text-muted">
          {props.tool.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}

export function ServerDetailModal(props: {
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
  initialTab?: ServerDetailTab;
}) {
  const [activeTab, setActiveTab] = useState<ServerDetailTab>(props.initialTab ?? "config");
  const overviewItems = [
    { label: "Server ID", value: props.server.slug, mono: true },
    { label: "传输", value: props.server.transport },
    { label: "工作目录", value: props.server.cwd ?? "跟随服务进程", mono: true },
    { label: "Tool 数", value: formatCount(props.server.tool_count) },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-section bg-glass-92">
          <DialogClose
            label="关闭 MCP server 详情"
            className="absolute right-5 top-5 z-20 size-9 border-transparent bg-transparent text-muted hover:border-transparent hover:bg-transparent hover:text-ink"
          />

          <DialogHeader className="py-5">
            <div className="pr-10">
              <DialogTitle className="truncate">{props.server.name}</DialogTitle>
              <p className="mt-2 text-sm text-muted">
                当前状态：
                <span className="font-medium text-ink">
                  {props.server.enabled ? " 已启用" : " 已停用"} ·{" "}
                  {statusLabel(props.server.status)}
                </span>
                {props.server.last_error ? (
                  <span className="text-red-700"> · 最近一次连接异常</span>
                ) : null}
              </p>
              <ExpandableSummary text={props.server.command} />
            </div>

            <CompactMetaStrip items={overviewItems} />
          </DialogHeader>

          <DialogBody className="py-6">
            <div
              role="tablist"
              aria-label="MCP Server 详情视图"
              className="flex flex-wrap items-center gap-6 border-b border-line"
            >
              <DetailTabButton
                tab="config"
                activeTab={activeTab}
                label="配置"
                onSelect={setActiveTab}
              />
              <DetailTabButton
                tab="tools"
                activeTab={activeTab}
                label="工具"
                onSelect={setActiveTab}
              />
            </div>

            <div className="pt-6">
              {activeTab === "config" ? (
                <div
                  id="mcp-server-panel-config"
                  role="tabpanel"
                  aria-labelledby="mcp-server-tab-config"
                >
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={props.serverBusy}
                        onClick={() => void props.onRefresh()}
                      >
                        刷新目录
                      </Button>
                      <Button size="sm" variant="outline" onClick={props.onEdit}>
                        编辑配置
                      </Button>
                      <Button
                        size="sm"
                        variant={props.server.enabled ? "outline" : "primary"}
                        disabled={props.serverBusy}
                        onClick={() => void props.onToggleServer()}
                      >
                        {props.server.enabled ? "停用 Server" : "启用 Server"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={props.serverBusy}
                        onClick={() => void props.onDelete()}
                      >
                        删除配置
                      </Button>
                    </div>

                    <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                      <div className="space-y-6">
                        {props.server.last_error ? (
                          <p className="text-sm leading-6 text-red-700">
                            最近一次异常：{props.server.last_error}
                          </p>
                        ) : null}

                        <div>
                          <p className="text-xs tracking-label text-muted">标准 JSON</p>
                          <pre className="mt-3 overflow-x-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                            {stringifyMcpServerJsonDocument(props.server)}
                          </pre>
                        </div>

                        <div className="border-t border-line pt-6">
                          <p className="text-xs tracking-label text-muted">最近活跃</p>
                          <p className="mt-3 text-base leading-7 text-muted-strong">
                            {formatDateTime(props.server.last_seen_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  id="mcp-server-panel-tools"
                  role="tabpanel"
                  aria-labelledby="mcp-server-tab-tools"
                >
                  <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                    <div className="space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs tracking-label text-muted">已发现工具</p>
                        <p className="text-sm text-muted">{formatCount(props.tools.length)} 项</p>
                      </div>

                      <div className="space-y-3">
                        {props.tools.length > 0 ? (
                          props.tools.map((tool) => (
                            <div
                              key={tool.id}
                              className="flex items-start gap-4 rounded-panel border border-line bg-white/78 px-4 py-4"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-mono text-sm text-ink">
                                  {tool.local_name}
                                </p>
                                <p className="mt-1 text-base text-muted-strong">
                                  {tool.remote_name}
                                </p>
                                <p className="mt-2 text-sm leading-6 text-muted">
                                  {tool.summary ?? "该 MCP tool 未提供描述。"}
                                </p>
                              </div>

                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                <ToggleButton
                                  enabled={tool.enabled}
                                  busy={props.busyToolId === tool.id}
                                  onToggle={() => props.onToggleTool(tool)}
                                />
                                <span className="text-xs font-medium text-muted">
                                  {tool.enabled ? "已启用" : "已停用"}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-panel border border-dashed border-line bg-white/60 px-4 py-8 text-center text-base text-muted">
                            暂无 MCP tool
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function ServerEditorModal(props: {
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
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-section bg-glass-92">
          <DialogClose
            label="关闭 MCP server 编辑器"
            className="absolute right-5 top-5 z-20 size-9 border-transparent bg-transparent text-muted hover:border-transparent hover:bg-transparent hover:text-ink"
          />

          <DialogHeader className="py-5">
            <div className="pr-10">
              <DialogTitle>
                {props.mode === "create" ? "粘贴标准 MCP JSON" : "编辑 MCP JSON 配置"}
              </DialogTitle>
              <p className="mt-2 text-sm leading-6 text-muted">
                {props.mode === "create"
                  ? "创建后会立即连接并刷新目录。"
                  : "保存后会重新连接并同步最新的 MCP tools。"}
              </p>
            </div>

            <CompactMetaStrip
              items={[
                { label: "模式", value: props.mode === "create" ? "新建" : "编辑" },
                { label: "格式", value: "MCP JSON" },
                {
                  label: "提交",
                  value: props.mode === "create" ? "创建并连接" : "保存并刷新",
                },
              ]}
            />
          </DialogHeader>

          <DialogBody className="py-6">
            <form
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                void props.onSubmit();
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs tracking-label text-muted">配置内容</p>
                <Button type="button" size="sm" variant="outline" onClick={props.onFillExample}>
                  填入 TAPD 示例
                </Button>
              </div>

              <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                <div className="space-y-6">
                  <textarea
                    value={props.jsonText}
                    onChange={(event) => props.onChange(event.target.value)}
                    spellCheck={false}
                    placeholder={TAPD_MCP_JSON_EXAMPLE}
                    className="min-h-[320px] w-full rounded-panel border border-line-strong bg-white/78 px-4 py-4 font-mono text-base leading-6 text-ink outline-none transition duration-300 ease-expo placeholder:text-muted focus:border-accent focus:shadow-focus-accent"
                  />

                  {props.error ? (
                    <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                      {props.error}
                    </div>
                  ) : null}

                  <div className="border-t border-line pt-6">
                    <p className="text-xs tracking-label text-muted">输入示例</p>
                    <pre className="mt-3 max-h-60 overflow-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                      {TAPD_MCP_JSON_EXAMPLE}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-glass-92 px-1 pt-4">
                <Button type="button" variant="outline" onClick={props.onClose}>
                  取消
                </Button>
                <Button disabled={props.busy} type="submit">
                  {props.mode === "create" ? "创建并连接" : "保存并刷新"}
                </Button>
              </div>
            </form>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
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
  const enabledServerCount = servers.filter((server) => server.enabled).length;
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

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">MCP Servers</p>
              <h2 className="mt-1.5 text-6xl text-ink">
                远端 tools 接入中心
                <span className="ml-2 align-middle text-lg font-normal text-muted">
                  ({connectedCount}/{servers.length} 已连接)
                </span>
              </h2>
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

          <div className="relative w-full xl:max-w-[360px]">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={serverQuery}
              onChange={(event) => setServerQuery(event.target.value)}
              placeholder="搜索 server 名称、slug、命令或状态"
              className="h-10 rounded-lg pl-10"
            />
          </div>
        </section>

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载 MCP 列表失败：{error}
          </div>
        ) : null}

        {mutationError ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            操作失败：{mutationError}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-section border border-notice-success-border bg-notice-success-bg px-4 py-3 text-base leading-6 text-accent-strong">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-lg border border-line bg-glass-80 px-3.5 py-3.5 md:px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="ui-skeleton size-10 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ui-skeleton h-5 rounded-lg" />
                    <div className="ui-skeleton h-4 rounded-lg" />
                    <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                  </div>
                  <div className="ui-skeleton h-8 w-[50px] rounded-full" />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {!loading && filteredServers.length === 0 ? (
          <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
            <p className="text-xl font-medium text-ink">
              {servers.length === 0 ? "还没有 MCP 配置" : "没有匹配到 MCP server"}
            </p>
          </section>
        ) : null}

        {!loading && filteredServers.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <LinkIcon className="size-4 text-muted-strong" />
              <span>当前展示 {formatCount(filteredServers.length)} 个 MCP server</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {filteredServers.map((server, index) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  index={index}
                  busy={serverBusyId === server.id}
                  selected={filterServerId === server.id}
                  onOpen={() =>
                    startTransition(() => {
                      setFilterServerId(server.id);
                      setActiveServerId(server.id);
                    })
                  }
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

        <section className="bg-frost-72 mt-2 space-y-3 rounded-dialog py-5">
          {" "}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="text-xs uppercase tracking-label-xl text-muted">Discovered Tools</p>
                <h3 className="mt-1.5 text-5xl text-ink">
                  MCP tools 目录
                  <span className="ml-2 align-middle text-md font-normal text-muted">
                    ({enabledToolCount}/{tools.length} 已启用)
                  </span>
                </h3>
              </div>
              {filterServer ? (
                <button
                  type="button"
                  onClick={() => setFilterServerId(null)}
                  className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-notice-success-border bg-notice-success-bg px-3 py-1 text-sm font-medium text-accent-strong transition hover:bg-success-solid"
                >
                  筛选：{filterServer.name}
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </div>

            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
                placeholder="搜索 tool 名称 / server"
                className="h-10 rounded-lg pl-10"
              />
            </div>
          </div>
          {!loading && filteredTools.length === 0 ? (
            <section className="rounded-lg border border-dashed border-line bg-glass-48 px-5 py-8 text-center">
              <p className="text-lg font-medium text-ink">
                {filterServer ? `${filterServer.name} 下暂无匹配的 tool` : "没有匹配到 MCP tool"}
              </p>
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
          onEdit={() =>
            startTransition(() => setEditorState({ mode: "edit", serverId: activeServer.id }))
          }
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
