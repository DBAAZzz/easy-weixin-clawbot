import type { ToolInfo } from "@clawbot/shared";
import { Input, SearchIcon, Switch, ToolsIcon, ArrowRightIcon } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { cn } from "../../lib/cn.js";
import { formatOriginLabel } from "./types.js";

export function ToolsTable(props: {
  errorEmpty: boolean;
  filteredTools: ToolInfo[];
  loading: boolean;
  onlyEnabled: boolean;
  onOnlyEnabledChange: (value: boolean) => void;
  onOpenTool: (tool: ToolInfo) => void;
  query: string;
  setQuery: (value: string) => void;
  tools: ToolInfo[];
}) {
  if (props.loading) {
    return <ToolsTableSkeleton />;
  }

  return (
    <>
      <ToolsTableToolbar
        count={props.filteredTools.length}
        onlyEnabled={props.onlyEnabled}
        query={props.query}
        total={props.tools.length}
        onOnlyEnabledChange={props.onOnlyEnabledChange}
        onQueryChange={props.setQuery}
      />
      <ToolsTableHead />
      {props.filteredTools.length === 0 ? (
        <ToolsTableEmpty emptyInstall={props.errorEmpty} />
      ) : (
        props.filteredTools.map((tool) => (
          <ToolTableRow key={tool.name} tool={tool} onOpen={() => props.onOpenTool(tool)} />
        ))
      )}
      <div className="flex flex-col gap-3 bg-account-table-head px-5 py-3.5 md:flex-row md:items-center md:justify-between md:px-6">
        <span className="text-sm text-account-muted-soft">
          共{" "}
          <span className="font-mono font-semibold text-account-ink-soft">
            {formatCount(props.filteredTools.length)}
          </span>{" "}
          个工具
        </span>
      </div>
    </>
  );
}

function ToolsTableToolbar(props: {
  count: number;
  onlyEnabled: boolean;
  query: string;
  total: number;
  onOnlyEnabledChange: (value: boolean) => void;
  onQueryChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-account-line px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-5">
      <div className="w-full md:w-account-search">
        <Input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder="搜索工具、描述、来源或参数"
          leftIcon={<SearchIcon />}
          size="sm"
          inputClassName="rounded-card border-account-line-strong bg-account-card text-base placeholder:text-account-muted-faint focus:border-account-control-hover"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-account-muted">
        <label className="inline-flex items-center gap-2 text-md font-medium text-account-muted">
          <Switch
            checked={props.onlyEnabled}
            label="仅看启用"
            onCheckedChange={props.onOnlyEnabledChange}
            size="sm"
            tone="ink"
          />
          仅看启用
        </label>
        <span className="hidden h-4 w-px bg-account-line-strong md:block" />
        <span className="font-mono text-sm text-account-muted-soft">
          {formatCount(props.count)} / {formatCount(props.total)}
        </span>
      </div>
    </div>
  );
}

function ToolsTableHead() {
  return (
    <div className="hidden border-b border-account-line bg-account-table-head px-6 py-3 lg:grid lg:tools-table-grid">
      <p className="text-sm font-semibold tracking-body text-account-muted-soft">工具</p>
      <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
        来源
      </p>
      <p className="text-sm font-semibold tracking-body text-account-muted-soft">参数</p>
      <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
        启用
      </p>
      <p className="text-right text-sm font-semibold tracking-body text-account-muted-soft">操作</p>
    </div>
  );
}

function ToolTableRow(props: { onOpen: () => void; tool: ToolInfo }) {
  return (
    <article className="border-b border-account-line-soft last:border-b-0">
      <div className="hidden w-full items-center px-6 py-3 transition duration-200 ease-expo hover:bg-account-table-head lg:grid lg:tools-table-grid">
        <ToolIdentity tool={props.tool} />
        <div className="flex justify-center">
          <OriginPill origin={props.tool.origin} />
        </div>
        <ParameterList parameterNames={props.tool.parameterNames} />
        <div className="flex justify-center">
          <Switch
            checked={props.tool.enabled}
            disabled
            label={props.tool.enabled ? "工具已启用" : "工具已停用"}
            size="sm"
            tone="ink"
          />
        </div>
        <RowAction onOpen={props.onOpen} />
      </div>

      <div className="flex flex-col gap-3 px-4 py-3.5 lg:hidden">
        <ToolIdentity tool={props.tool} />
        <div className="grid grid-cols-3 gap-3">
          <Metric label="来源" value={<OriginPill origin={props.tool.origin} />} />
          <Metric label="参数" value={formatCount(props.tool.parameterNames.length)} />
          <Metric label="状态" value={props.tool.enabled ? "已启用" : "已停用"} />
        </div>
        <div className="flex items-center justify-between border-t border-account-line pt-3">
          <Switch
            checked={props.tool.enabled}
            disabled
            label={props.tool.enabled ? "工具已启用" : "工具已停用"}
            size="sm"
            tone="ink"
          />
          <RowAction onOpen={props.onOpen} />
        </div>
      </div>
    </article>
  );
}

function ToolIdentity(props: { tool: ToolInfo }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-card border transition duration-200 ease-expo",
          props.tool.enabled
            ? "border-notice-success-border bg-notice-success-bg text-accent-strong"
            : "border-account-line-strong bg-account-filter-track text-account-muted-faint",
        )}
      >
        <ToolsIcon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-sm font-semibold leading-tight text-account-ink">
          {props.tool.name}
        </p>
        <p className="mt-0.5 truncate text-sm leading-5 text-account-muted">
          {props.tool.description}
        </p>
      </div>
    </div>
  );
}

function OriginPill(props: { origin: ToolInfo["origin"] }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-card border border-account-line bg-account-table-head px-2 py-1 text-sm font-medium text-account-ink-soft">
      <span className="size-1.5 shrink-0 rounded-full bg-account-success-dot" />
      <span className="truncate">{formatOriginLabel(props.origin)}</span>
    </span>
  );
}

function ParameterList(props: { parameterNames: string[] }) {
  const previewParameters = props.parameterNames.slice(0, 3);
  const restCount = props.parameterNames.length - previewParameters.length;

  if (props.parameterNames.length === 0) {
    return <span className="text-sm text-account-muted-faint">无参数</span>;
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5 pr-3">
      {previewParameters.map((name) => (
        <span
          key={name}
          className="rounded-card bg-account-filter-track px-2 py-1 font-mono text-xs font-semibold text-account-ink-soft"
        >
          {name}
        </span>
      ))}
      {restCount > 0 ? (
        <span className="rounded-card bg-account-table-head px-2 py-1 font-mono text-xs font-semibold text-account-muted-soft">
          +{formatCount(restCount)}
        </span>
      ) : null}
    </div>
  );
}

function RowAction(props: { onOpen: () => void }) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={props.onOpen}
        className="group inline-flex items-center gap-1.5 text-base font-semibold text-account-ink transition duration-200 ease-expo hover:text-accent focus-visible:outline-none focus-visible:shadow-focus-accent"
      >
        详情
        <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}

function Metric(props: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-sm font-medium text-account-muted-soft">{props.label}</p>
      <div className="mt-1 font-mono text-sm font-semibold text-account-ink-soft">
        {props.value}
      </div>
    </div>
  );
}

function ToolsTableSkeleton() {
  return (
    <div>
      <div className="border-b border-account-line px-4 py-4 xl:px-5">
        <div className="ui-skeleton h-9 rounded-card md:w-account-search" />
      </div>
      <div className="hidden border-b border-account-line bg-account-table-head px-6 py-3 lg:grid lg:tools-table-grid">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="ui-skeleton h-3 rounded-pill" />
        ))}
      </div>
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="grid gap-3 border-b border-account-line-soft px-6 py-4 last:border-b-0 lg:tools-table-grid"
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

function ToolsTableEmpty(props: { emptyInstall: boolean }) {
  return (
    <div className="flex min-h-60 flex-col items-center justify-center px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-section bg-account-filter-track text-account-muted">
        <ToolsIcon className="size-5" />
      </span>
      <p className="mt-4 text-lg font-semibold text-account-ink-soft">
        {props.emptyInstall ? "暂无已安装的工具" : "没有匹配的工具"}
      </p>
      <p className="mt-1 text-sm text-account-muted-soft">
        {props.emptyInstall ? "工具同步后会出现在这里" : "调整搜索关键词或筛选条件"}
      </p>
    </div>
  );
}
