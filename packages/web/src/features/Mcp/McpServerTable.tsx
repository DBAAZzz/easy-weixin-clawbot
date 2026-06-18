import type { ReactNode } from "react";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import {
  Badge,
  Button,
  CardToggle,
  ChevronRightIcon,
  Input,
  PencilIcon,
  SearchIcon,
  McpServerIcon,
  ToolsIcon,
  Toggle,
  TrashIcon,
} from "@clawbot/ui";
import { cn } from "@/lib/cn.js";
import { formatCount, formatRelativeTime } from "@/lib/format.js";
import { statusLabel, statusTone } from "./types.js";

export function McpServerTable(props: {
  errorEmpty: boolean;
  expandedServerIds: Record<string, boolean>;
  filteredServers: McpServerInfo[];
  loading: boolean;
  onlyEnabled: boolean;
  onCreate: () => void;
  onDeleteServer: (server: McpServerInfo) => void;
  onEditServer: (server: McpServerInfo) => void;
  onOnlyEnabledChange: (value: boolean) => void;
  onToggleServer: (server: McpServerInfo) => void | Promise<void>;
  onToggleTool: (tool: McpToolInfo) => void | Promise<void>;
  onToggleVisibleExpanded: () => void;
  onToggleServerExpanded: (serverId: string) => void;
  query: string;
  serverBusyId: string | null;
  servers: McpServerInfo[];
  setQuery: (value: string) => void;
  toolBusyId: string | null;
  tools: McpToolInfo[];
  visibleExpanded: boolean;
}) {
  if (props.loading) {
    return <McpTableSkeleton />;
  }

  return (
    <>
      <McpTableToolbar
        count={props.filteredServers.length}
        onlyEnabled={props.onlyEnabled}
        query={props.query}
        total={props.servers.length}
        visibleExpanded={props.visibleExpanded}
        onCreate={props.onCreate}
        onOnlyEnabledChange={props.onOnlyEnabledChange}
        onQueryChange={props.setQuery}
        onToggleVisibleExpanded={props.onToggleVisibleExpanded}
      />
      <McpTableHead />
      {props.filteredServers.length === 0 ? (
        <McpTableEmpty emptyConfig={props.errorEmpty} onCreate={props.onCreate} />
      ) : (
        props.filteredServers.map((server) => (
          <McpServerRow
            key={server.id}
            expanded={Boolean(props.expandedServerIds[server.id])}
            server={server}
            serverBusy={props.serverBusyId === server.id}
            toolBusyId={props.toolBusyId}
            tools={props.tools.filter((tool) => tool.server_id === server.id)}
            onDelete={() => props.onDeleteServer(server)}
            onEdit={() => props.onEditServer(server)}
            onToggle={() => props.onToggleServer(server)}
            onToggleExpanded={() => props.onToggleServerExpanded(server.id)}
            onToggleTool={props.onToggleTool}
          />
        ))
      )}
      <div className="flex flex-col gap-3 bg-account-table-head px-5 py-3.5 md:flex-row md:items-center md:justify-between md:px-6">
        <span className="text-sm text-account-muted-soft">
          共{" "}
          <span className="font-mono font-semibold text-account-ink-soft">
            {formatCount(props.filteredServers.length)}
          </span>{" "}
          个 MCP server
        </span>
      </div>
    </>
  );
}

function McpTableToolbar(props: {
  count: number;
  onlyEnabled: boolean;
  query: string;
  total: number;
  visibleExpanded: boolean;
  onCreate: () => void;
  onOnlyEnabledChange: (value: boolean) => void;
  onQueryChange: (value: string) => void;
  onToggleVisibleExpanded: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-account-line px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-5">
      <div className="w-full md:w-account-search">
        <Input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="搜索服务器或工具"
          leftIcon={<SearchIcon />}
          size="sm"
          inputClassName="rounded-card border-account-line-strong bg-account-card text-base placeholder:text-account-muted-faint focus:border-account-control-hover"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-account-muted">
        <Toggle
          value="enabled"
          pressed={props.onlyEnabled}
          onPressedChange={props.onOnlyEnabledChange}
          size="sm"
          tone="ink"
          className="gap-2 px-3 text-md text-account-muted hover:text-account-ink-soft data-[pressed]:text-account-ink"
        >
          仅看启用
        </Toggle>
        <span className="hidden h-4 w-px bg-account-line-strong md:block" />
        <button
          type="button"
          onClick={props.onToggleVisibleExpanded}
          className="text-md font-semibold text-account-muted transition duration-200 ease-expo hover:text-account-ink"
        >
          {props.visibleExpanded ? "收起全部" : "展开全部"}
        </button>
        <span className="font-mono text-sm text-account-muted-soft">
          {formatCount(props.count)} / {formatCount(props.total)}
        </span>
      </div>
    </div>
  );
}

function McpTableHead() {
  return (
    <div className="hidden border-b border-account-line bg-account-table-head px-6 py-3 lg:grid lg:mcp-server-table-grid">
      <p className="text-sm font-semibold tracking-body text-account-muted-soft">服务器</p>
      <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
        传输
      </p>
      <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
        工具
      </p>
      <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
        启用
      </p>
      <p className="text-right text-sm font-semibold tracking-body text-account-muted-soft">操作</p>
    </div>
  );
}

function McpServerRow(props: {
  expanded: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void | Promise<void>;
  onToggleExpanded: () => void;
  onToggleTool: (tool: McpToolInfo) => void | Promise<void>;
  server: McpServerInfo;
  serverBusy: boolean;
  toolBusyId: string | null;
  tools: McpToolInfo[];
}) {
  return (
    <article className="border-b border-account-line-soft last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        onClick={props.onToggleExpanded}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            props.onToggleExpanded();
          }
        }}
        className="hidden w-full items-center px-6 py-3 text-left transition duration-200 ease-expo hover:bg-account-table-head focus-visible:outline-none focus-visible:shadow-focus-accent lg:grid lg:mcp-server-table-grid"
        aria-expanded={props.expanded}
      >
        <ServerIdentity expanded={props.expanded} server={props.server} />
        <div className="flex justify-center">
          <TransportPill transport={props.server.transport} />
        </div>
        <div className="flex justify-center">
          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-account-ink-soft">
            <ToolsIcon className="size-4 text-account-muted-faint" />
            {formatCount(props.server.tool_count)}
          </span>
        </div>
        <div className="flex justify-center" onClick={(event) => event.stopPropagation()}>
          <CardToggle
            enabled={props.server.enabled}
            busy={props.serverBusy}
            label={props.server.enabled ? "停用 MCP 服务" : "启用 MCP 服务"}
            onToggle={props.onToggle}
          />
        </div>
        <RowActions onDelete={props.onDelete} onEdit={props.onEdit} />
      </div>

      <div className="flex flex-col gap-3 px-4 py-3.5 lg:hidden">
        <button
          type="button"
          onClick={props.onToggleExpanded}
          className="flex items-start gap-3 text-left"
          aria-expanded={props.expanded}
        >
          <ServerIdentity compact expanded={props.expanded} server={props.server} />
        </button>
        <div className="grid grid-cols-3 gap-3">
          <Metric label="传输" value={<TransportPill transport={props.server.transport} />} />
          <Metric label="工具" value={formatCount(props.server.tool_count)} />
          <Metric label="状态" value={props.server.enabled ? "已启用" : "已停用"} />
        </div>
        <div className="flex items-center justify-between border-t border-account-line pt-3">
          <CardToggle
            enabled={props.server.enabled}
            busy={props.serverBusy}
            label={props.server.enabled ? "停用 MCP 服务" : "启用 MCP 服务"}
            onToggle={props.onToggle}
          />
          <RowActions onDelete={props.onDelete} onEdit={props.onEdit} />
        </div>
      </div>

      {props.expanded ? (
        <ExpandedTools
          server={props.server}
          toolBusyId={props.toolBusyId}
          tools={props.tools}
          onToggleTool={props.onToggleTool}
        />
      ) : null}
    </article>
  );
}

function ServerIdentity(props: { compact?: boolean; expanded: boolean; server: McpServerInfo }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ChevronRightIcon
        className={cn(
          "size-4 shrink-0 text-account-muted-faint transition duration-200 ease-expo",
          props.expanded && "rotate-90 text-account-ink-soft",
        )}
      />
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-card border transition duration-200 ease-expo",
          props.server.enabled
            ? "border-notice-success-border bg-notice-success-bg text-accent-strong"
            : "border-account-line-strong bg-account-filter-track text-account-muted-faint",
        )}
      >
        <McpServerIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold leading-tight text-account-ink">
            {props.server.name}
          </p>
          <Badge size="sm" bordered={false} showDot={false} tone={statusTone(props.server.status)}>{statusLabel(props.server.status)}</Badge>
        </div>
        <p
          className="mt-0.5 truncate font-mono text-xs tracking-body text-account-muted-soft"
          title={props.server.command}
        >
          {props.server.command}
        </p>
        {props.server.last_error ? (
          <p className="mt-1 line-clamp-1 text-sm leading-5 text-danger">
            {props.server.last_error}
          </p>
        ) : (
          <p className="mt-1 text-sm text-account-muted-faint">
            {formatRelativeTime(props.server.last_seen_at)}
          </p>
        )}
      </div>
    </div>
  );
}

function TransportPill(props: { transport: McpServerInfo["transport"] }) {
  return (
    <span className="rounded-card bg-account-filter-track px-2 py-1 font-mono text-xs font-semibold uppercase text-account-ink-soft">
      {props.transport}
    </span>
  );
}

function RowActions(props: { onDelete: () => void; onEdit: () => void }) {
  return (
    <div
      className="flex items-center justify-end gap-1.5"
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={props.onEdit}
        className="!size-8 border-account-line-strong bg-account-card text-account-muted hover:border-account-control-hover hover:bg-account-table-head hover:text-account-ink"
        title="编辑配置"
        aria-label="编辑配置"
      >
        <PencilIcon />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={props.onDelete}
        className="!size-8 border-account-line-strong bg-account-card text-account-muted hover:border-notice-error-border hover:bg-notice-error-bg hover:text-danger"
        title="删除"
        aria-label="删除"
      >
        <TrashIcon />
      </Button>
    </div>
  );
}

function ExpandedTools(props: {
  onToggleTool: (tool: McpToolInfo) => void | Promise<void>;
  server: McpServerInfo;
  toolBusyId: string | null;
  tools: McpToolInfo[];
}) {
  return (
    <div className="border-t border-account-line-soft bg-account-table-head px-4 py-3 lg:px-14">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <span className="text-xs font-semibold text-account-muted-soft">
          {formatCount(props.tools.length)} 个工具可用
        </span>
      </div>
      {props.tools.length === 0 ? (
        <div className="rounded-card border border-dashed border-account-line-strong bg-account-card px-4 py-4 text-base text-account-muted">
          暂无工具
        </div>
      ) : (
        <div className="space-y-2">
          {props.tools.map((tool) => (
            <McpToolRow
              key={tool.id}
              busy={props.toolBusyId === tool.id}
              tool={tool}
              onToggle={() => props.onToggleTool(tool)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function McpToolRow(props: {
  busy: boolean;
  onToggle: () => void | Promise<void>;
  tool: McpToolInfo;
}) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-account-line bg-account-card px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-card bg-account-filter-track text-account-muted">
        <ToolsIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm font-semibold text-account-ink-soft">
          {props.tool.remote_name}
        </p>
        <p className="mt-0.5 truncate text-sm text-account-muted">
          {props.tool.summary ?? props.tool.local_name}
        </p>
      </div>
      <span className="hidden min-w-10 text-right text-sm font-semibold text-account-muted md:block">
        {props.tool.enabled ? "已启用" : "已停用"}
      </span>
      <CardToggle
        enabled={props.tool.enabled}
        busy={props.busy}
        label={props.tool.enabled ? "停用 MCP 工具" : "启用 MCP 工具"}
        onToggle={props.onToggle}
      />
    </div>
  );
}

function Metric(props: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-account-muted-soft">{props.label}</p>
      <div className="mt-1 font-mono text-sm font-semibold text-account-ink-soft">
        {props.value}
      </div>
    </div>
  );
}

function McpTableSkeleton() {
  return (
    <div>
      <div className="border-b border-account-line px-4 py-4 xl:px-5">
        <div className="ui-skeleton h-9 rounded-card md:w-account-search" />
      </div>
      <div className="hidden border-b border-account-line bg-account-table-head px-6 py-3 lg:grid lg:mcp-server-table-grid">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="ui-skeleton h-3 rounded-pill" />
        ))}
      </div>
      {Array.from({ length: 5 }).map((_, index) => (
        <div
          key={index}
          className="grid gap-3 border-b border-account-line-soft px-6 py-4 last:border-b-0 lg:mcp-server-table-grid"
        >
          <div className="ui-skeleton h-10 rounded-panel" />
          <div className="ui-skeleton h-7 rounded-pill" />
          <div className="ui-skeleton h-7 rounded-card" />
          <div className="ui-skeleton h-7 rounded-pill" />
          <div className="ui-skeleton h-7 rounded-card" />
        </div>
      ))}
    </div>
  );
}

function McpTableEmpty(props: { emptyConfig: boolean; onCreate: () => void }) {
  return (
    <div className="flex items-center justify-center px-5 py-10 md:grid-cols-2 md:items-end">
      <div>
        <p className="text-base font-semibold uppercase tracking-caps-lg text-account-muted-soft">
          {props.emptyConfig ? "暂无配置" : "没有匹配结果"}
        </p>
        <p className="mt-2 text-base text-account-muted">
          {props.emptyConfig ? "添加一个 MCP server 后会显示在这里" : "调整搜索或筛选条件"}
        </p>
      </div>
    </div>
  );
}
