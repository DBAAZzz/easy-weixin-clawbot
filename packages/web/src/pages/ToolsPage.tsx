import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { MarkdownSource, ToolInfo } from "@clawbot/shared";
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
import { useQuery } from "@tanstack/react-query";
import { useTools } from "../hooks/useTools.js";
import { fetchToolSource } from "@/api/tools.js";
import { queryKeys } from "../lib/query-keys.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";

function formatOriginLabel(origin: ToolInfo["origin"]) {
  return origin === "builtin" ? "内置" : "用户层";
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

function ToolToggle(props: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={props.busy}
      aria-label={props.enabled ? "停用 tool" : "启用 tool"}
      aria-pressed={props.enabled}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void props.onToggle();
      }}
      className={cn(
        "relative inline-flex h-8 w-[50px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        props.enabled
          ? "border-toggle-border bg-accent"
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

function ParameterChip(props: { name: string }) {
  return (
    <span className="rounded-full border border-line bg-white/78 px-2 py-1 font-mono text-2xs tracking-mono text-muted-strong">
      {props.name}
    </span>
  );
}

function ToolCard(props: {
  tool: ToolInfo;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void | Promise<void>;
}) {
  const metadata = [
    `版本 ${props.tool.version}`,
    props.tool.handler,
    formatOriginLabel(props.tool.origin),
  ];
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

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">{props.tool.summary}</p>

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
        <ToolToggle enabled={props.tool.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-xs font-medium text-muted">
          {props.tool.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}

type ToolDetailTab = "markdown" | "config";
type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; code: string };

function stripMarkdownFrontmatter(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/u, "").trim();
}

function isMarkdownBlockBoundary(line: string) {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("```") ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    trimmed.startsWith(">")
  );
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = stripMarkdownFrontmatter(markdown).replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const currentLine = lines[index]!;
    const trimmed = currentLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeMatch = /^```([a-zA-Z0-9_-]+)?$/.exec(trimmed);
    if (codeMatch) {
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length && !/^```$/.test(lines[index]!.trim())) {
        codeLines.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({
        type: "code",
        language: codeMatch[1] ?? null,
        code: codeLines.join("\n").trimEnd(),
      });
      continue;
    }

    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    const orderedList = /^\d+\.\s+/.test(trimmed);
    const unorderedList = /^[-*]\s+/.test(trimmed);
    if (orderedList || unorderedList) {
      const items: string[] = [];
      while (index < lines.length) {
        const listLine = lines[index]!.trim();
        if (!listLine) break;
        if (orderedList && /^\d+\.\s+/.test(listLine)) {
          items.push(listLine.replace(/^\d+\.\s+/u, ""));
          index += 1;
          continue;
        }
        if (unorderedList && /^[-*]\s+/.test(listLine)) {
          items.push(listLine.replace(/^[-*]\s+/u, ""));
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "list", ordered: orderedList, items });
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith(">")) {
        quoteLines.push(lines[index]!.trim().replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join(" ") });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;
    while (index < lines.length && !isMarkdownBlockBoundary(lines[index]!)) {
      paragraphLines.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const tokens = text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/u)
    .filter(Boolean);

  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;

    if (token.startsWith("**") && token.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>
      );
    }

    if (token.startsWith("*") && token.endsWith("*")) {
      return (
        <em key={key} className="italic text-ink-soft">
          {token.slice(1, -1)}
        </em>
      );
    }

    if (token.startsWith("`") && token.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded-xs bg-accent-mist px-1.5 py-0.5 font-mono text-sm text-accent-strong"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(token);
    if (linkMatch) {
      return (
        <a
          key={key}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="underline decoration-line underline-offset-4 transition hover:text-accent-strong"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={key}>{token}</span>;
  });
}

function ToolMarkdownDocument(props: { markdown: string }) {
  const blocks = parseMarkdownBlocks(props.markdown);

  if (blocks.length === 0) {
    return <p className="text-base leading-7 text-muted">暂无文档正文</p>;
  }

  return (
    <article className="space-y-4">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h4
                key={`heading-${index}`}
                className="text-4xl font-semibold tracking-title text-ink"
              >
                {renderInlineMarkdown(block.text, `heading-${index}`)}
              </h4>
            );
          }

          if (block.level === 2) {
            return (
              <h5
                key={`heading-${index}`}
                className="pt-2 text-2xl font-semibold tracking-title text-ink"
              >
                {renderInlineMarkdown(block.text, `heading-${index}`)}
              </h5>
            );
          }

          return (
            <h6
              key={`heading-${index}`}
              className="pt-1 text-xl font-semibold tracking-title text-ink-soft"
            >
              {renderInlineMarkdown(block.text, `heading-${index}`)}
            </h6>
          );
        }

        if (block.type === "paragraph") {
          return (
            <p key={`paragraph-${index}`} className="text-lg leading-7 text-ink-soft">
              {renderInlineMarkdown(block.text, `paragraph-${index}`)}
            </p>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={`blockquote-${index}`}
              className="border-l-2 border-accent pl-4 text-base leading-7 text-muted-strong"
            >
              {renderInlineMarkdown(block.text, `blockquote-${index}`)}
            </blockquote>
          );
        }

        if (block.type === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              key={`list-${index}`}
              className={cn(
                "space-y-2 pl-5 text-base leading-7 text-ink-soft marker:text-accent-strong",
                block.ordered ? "list-decimal" : "list-disc",
              )}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`list-${index}-${itemIndex}`}>
                  {renderInlineMarkdown(item, `list-${index}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <div
            key={`code-${index}`}
            className="overflow-hidden rounded-section border border-line bg-detail-bg"
          >
            {block.language ? (
              <div className="border-b border-line px-4 py-2 text-sm uppercase tracking-label text-muted">
                {block.language}
              </div>
            ) : null}
            <pre className="overflow-x-auto px-4 py-4 text-sm leading-6 text-ink-soft">
              <code>{block.code}</code>
            </pre>
          </div>
        );
      })}
    </article>
  );
}

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
  tab: ToolDetailTab;
  activeTab: ToolDetailTab;
  label: string;
  onSelect: (tab: ToolDetailTab) => void;
}) {
  const selected = props.activeTab === props.tab;

  return (
    <button
      id={`tool-tab-${props.tab}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`tool-panel-${props.tab}`}
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

export function ToolDetailModal(props: {
  tool: ToolInfo;
  source: { data: MarkdownSource | null; loading: boolean; error: string | null };
  toggleBusy: boolean;
  onClose: () => void;
  onToggle: () => void | Promise<void>;
  initialTab?: ToolDetailTab;
}) {
  const [activeTab, setActiveTab] = useState<ToolDetailTab>(props.initialTab ?? "markdown");
  const overviewItems = [
    { label: "版本", value: props.tool.version },
    { label: "Handler", value: props.tool.handler },
    { label: "来源", value: formatOriginLabel(props.tool.origin) },
    { label: "状态", value: props.tool.enabled ? "已启用" : "已停用" },
  ];
  const markdownBody = props.source.data?.markdown ?? "";
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
              <ExpandableSummary text={props.tool.summary} />
            </div>

            <CompactMetaStrip items={overviewItems} />
          </DialogHeader>

          <DialogBody className="py-6">
            <div
              role="tablist"
              aria-label="Tool 详情视图"
              className="flex flex-wrap items-center gap-6 border-b border-line"
            >
              <DetailTabButton
                tab="markdown"
                activeTab={activeTab}
                label="文档"
                onSelect={setActiveTab}
              />
              <DetailTabButton
                tab="config"
                activeTab={activeTab}
                label="参数配置"
                onSelect={setActiveTab}
              />
            </div>

            <div className="pt-6">
              {activeTab === "markdown" ? (
                <div id="tool-panel-markdown" role="tabpanel" aria-labelledby="tool-tab-markdown">
                  {props.source.loading ? (
                    <div className="space-y-3">
                      <div className="ui-skeleton h-5 rounded-lg" />
                      <div className="ui-skeleton h-4 rounded-lg" />
                      <div className="ui-skeleton h-4 rounded-lg" />
                      <div className="ui-skeleton h-4 rounded-lg" />
                      <div className="ui-skeleton h-28 rounded-section" />
                    </div>
                  ) : props.source.error ? (
                    <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                      加载源码失败：{props.source.error}
                    </div>
                  ) : (
                    <div className="rounded-panel bg-detail-bg px-6 py-7 md:px-7 md:py-8">
                      <ToolMarkdownDocument markdown={markdownBody} />
                    </div>
                  )}
                </div>
              ) : (
                <div id="tool-panel-config" role="tabpanel" aria-labelledby="tool-tab-config">
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant={props.tool.enabled ? "outline" : "primary"}
                        disabled={props.toggleBusy}
                        onClick={() => void props.onToggle()}
                      >
                        {props.tool.enabled ? "停用 Tool" : "启用 Tool"}
                      </Button>
                    </div>

                    <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
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

export function ToolsPage() {
  const { tools, loading, error, refresh, enable, disable } = useTools();
  const [query, setQuery] = useState("");
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingToggleName, setPendingToggleName] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredTools = tools.filter((tool) => {
    if (!normalizedQuery) return true;

    return [
      tool.name,
      tool.summary,
      tool.handler,
      tool.origin,
      tool.author ?? "",
      ...tool.parameterNames,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
  const activeTool = tools.find((tool) => tool.name === activeToolName) ?? null;
  const sourceQuery = useQuery({
    queryKey: queryKeys.toolSource(activeToolName ?? ""),
    queryFn: () => fetchToolSource(activeToolName!),
    enabled: Boolean(activeToolName),
  });
  const source = {
    data: sourceQuery.data ?? null,
    loading: Boolean(activeToolName) && sourceQuery.isPending,
    error:
      sourceQuery.error instanceof Error
        ? sourceQuery.error.message
        : sourceQuery.error
          ? String(sourceQuery.error)
          : null,
  };

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
  const userCount = tools.filter((tool) => tool.origin === "user").length;
  const handlerCount = new Set(tools.map((tool) => tool.handler)).size;

  async function handleRefresh() {
    setNotice(null);
    setMutationError(null);
    refresh();
  }

  async function handleToggle(tool: ToolInfo) {
    setNotice(null);
    setMutationError(null);
    setPendingToggleName(tool.name);

    try {
      const result = tool.enabled ? await disable(tool.name) : await enable(tool.name);
      setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingToggleName(null);
    }
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
                placeholder="搜索 tool 名称、摘要、handler 或参数"
                className="h-10 rounded-lg pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone="muted">已安装 {formatCount(tools.length)}</Badge>
              <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
              <Badge tone="muted">用户层 {formatCount(userCount)}</Badge>
              <Badge tone="muted">Handler {formatCount(handlerCount)}</Badge>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载 tool 列表失败：{error}
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
                  busy={pendingToggleName === tool.name}
                  onOpen={() => startTransition(() => setActiveToolName(tool.name))}
                  onToggle={() => handleToggle(tool)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {activeTool ? (
        <ToolDetailModal
          tool={activeTool}
          source={source}
          toggleBusy={pendingToggleName === activeTool.name}
          onClose={() => setActiveToolName(null)}
          onToggle={() => handleToggle(activeTool)}
        />
      ) : null}
    </>
  );
}
