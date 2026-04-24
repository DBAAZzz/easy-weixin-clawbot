import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { ToolInfo } from "@clawbot/shared";
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
import { Input } from "../components/ui/input.js";
import { ActivityIcon, SearchIcon, TerminalIcon } from "../components/ui/icons.js";
import { useTools } from "../hooks/useTools.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";

function formatOriginLabel(origin: ToolInfo["origin"]) {
  return origin === "builtin" ? "代码内置" : origin;
}

function ToolAvatar(props: { origin: ToolInfo["origin"] }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-frost-92",
        props.origin === "builtin"
          ? "border-line text-ink"
          : "border-accent-border text-accent-strong",
      )}
    >
      <TerminalIcon className="size-[18px]" />
    </span>
  );
}

function ParameterChip(props: { name: string }) {
  return (
    <span className="rounded-full border border-line bg-white/78 px-2 py-1 font-mono text-2xs tracking-mono text-muted-strong">
      {props.name}
    </span>
  );
}

function ToolCard(props: { tool: ToolInfo; index: number; onOpen: () => void }) {
  const metadata = [props.tool.handler, formatOriginLabel(props.tool.origin)];
  const previewParameters = props.tool.parameterNames.slice(0, 3);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`查看 ${props.tool.name} 详情`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className="reveal-up group flex min-h-[108px] cursor-pointer items-center gap-3 rounded-lg border border-card-line bg-card-bg px-3.5 py-3.5 transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent md:px-4"
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <ToolAvatar origin={props.tool.origin} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-title text-ink">{props.tool.name}</h3>
          <Badge
            tone="muted"
            className="border-transparent bg-accent-mist px-2 py-1 text-2xs tracking-tag text-accent-strong"
          >
            {props.tool.handler}
          </Badge>
        </div>

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">
          {props.tool.description}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {metadata.map((item, index) => (
            <span key={item} className="flex items-center gap-2">
              {index > 0 ? <span className="size-1 rounded-full bg-line-strong" /> : null}
              <span>{item}</span>
            </span>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {previewParameters.length > 0 ? (
            previewParameters.map((name) => <ParameterChip key={name} name={name} />)
          ) : (
            <span className="text-xs text-muted">无参数</span>
          )}
          {props.tool.parameterNames.length > previewParameters.length ? (
            <span className="text-xs text-muted">
              +{props.tool.parameterNames.length - previewParameters.length} more
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge tone="online">代码内置</Badge>
        <span className="text-xs font-medium text-muted">始终启用</span>
      </div>
    </div>
  );
}

function ExpandableDescription(props: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const description = props.text.trim();
  const canExpand = description.length > 60;

  if (!description) {
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
        {description}
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

function buildToolSnapshot(tool: ToolInfo) {
  return JSON.stringify(
    {
      handler: tool.handler,
      parameters: tool.parameterNames,
    },
    null,
    2,
  );
}

export function ToolDetailModal(props: { tool: ToolInfo; onClose: () => void }) {
  const overviewItems = [
    { label: "Handler", value: props.tool.handler },
    { label: "来源", value: formatOriginLabel(props.tool.origin) },
    { label: "状态", value: props.tool.enabled ? "已启用" : "已停用" },
  ];
  const parameterSnapshot = buildToolSnapshot(props.tool);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-section bg-glass-92">
          <DialogClose
            label="关闭 tool 详情"
            className="absolute right-5 top-5 z-20 size-9 border-transparent bg-transparent text-muted hover:border-transparent hover:bg-transparent hover:text-ink"
          />

          <DialogHeader className="py-5">
            <div className="pr-10">
              <DialogTitle className="truncate">{props.tool.name}</DialogTitle>
              <p className="mt-2 text-sm text-muted">
                当前状态：
                <span className="font-medium text-ink">
                  {props.tool.enabled ? " 已启用" : " 已停用"}
                </span>
              </p>
              <ExpandableDescription text={props.tool.description} />
            </div>

            <CompactMetaStrip items={overviewItems} />
          </DialogHeader>

          <DialogBody className="py-6">
            <div className="rounded-panel bg-detail-bg">
              <div className="space-y-6">
                <div>
                  <p className="text-xs tracking-label text-muted">参数快照</p>
                  <pre className="mt-3 overflow-x-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                    {parameterSnapshot}
                  </pre>
                </div>

                <div className="border-t border-line pt-6">
                  <p className="text-xs tracking-label text-muted">输入参数</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {props.tool.parameterNames.length > 0 ? (
                      props.tool.parameterNames.map((name) => (
                        <ParameterChip key={name} name={name} />
                      ))
                    ) : (
                      <p className="text-base leading-7 text-muted-strong">
                        该 Tool 当前无输入参数。
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function ToolsPage() {
  const { tools, loading, error, refresh } = useTools();
  const [query, setQuery] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredTools = tools.filter((tool) => {
    if (!normalizedQuery) return true;

    return [tool.name, tool.description, tool.handler, tool.origin, ...tool.parameterNames].some(
      (value) => value.toLowerCase().includes(normalizedQuery),
    );
  });
  const activeTool = tools.find((tool) => tool.name === activeToolName) ?? null;

  useEffect(() => {
    if (!activeToolName) return;

    if (!tools.some((tool) => tool.name === activeToolName)) {
      setActiveToolName(null);
    }
  }, [activeToolName, tools]);

  useEffect(() => {
    if (!activeToolName) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveToolName(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeToolName]);

  const enabledCount = tools.filter((tool) => tool.enabled).length;
  const handlerCount = new Set(tools.map((tool) => tool.handler)).size;

  async function handleRefresh() {
    refresh();
  }

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">Tools</p>
              <h2 className="mt-1.5 text-6xl text-ink">已安装工具</h2>
            </div>

            <Button size="sm" onClick={() => void handleRefresh()}>
              <ActivityIcon className="size-4" />
              刷新列表
            </Button>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 tool 名称、描述、handler 或参数"
                className="h-10 rounded-lg pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone="muted">已安装 {formatCount(tools.length)}</Badge>
              <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
              <Badge tone="muted">代码内置</Badge>
              <Badge tone="muted">Handler {formatCount(handlerCount)}</Badge>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载 tool 列表失败：{error}
          </div>
        ) : null}

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
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

        {!loading && filteredTools.length === 0 ? (
          <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
            <p className="text-xl font-medium text-ink">没有匹配到 tool</p>
          </section>
        ) : null}

        {!loading && filteredTools.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <TerminalIcon className="size-4 text-muted-strong" />
              <span>当前展示 {formatCount(filteredTools.length)} 个已安装 tool</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {filteredTools.map((tool, index) => (
                <ToolCard
                  key={tool.name}
                  tool={tool}
                  index={index}
                  onOpen={() => startTransition(() => setActiveToolName(tool.name))}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {activeTool ? (
        <ToolDetailModal tool={activeTool} onClose={() => setActiveToolName(null)} />
      ) : null}
    </>
  );
}
