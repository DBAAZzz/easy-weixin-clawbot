import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createRssSource,
  deleteRssSource,
  fetchRssSources,
  previewRssSource,
  testRssSource,
  updateRssSource,
  type RssSourceDto,
  type RssSourcePreviewDto,
} from "@/api/rss.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "../components/ui/dialog.js";
import { Input } from "../components/ui/input.js";
import { Select } from "../components/ui/select.js";
import { CardOverflowMenu, CardToggle, MetricGrid } from "../components/ui/admin-card.js";
import {
  ArrowRightIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  RssIcon,
  SearchIcon,
  TrashIcon,
} from "../components/ui/icons.js";
import { queryKeys } from "../lib/query-keys.js";
import { formatCount, formatDateTime } from "../lib/format.js";

type SourceDraft = {
  id?: string;
  name: string;
  sourceType: "rsshub_route" | "rss_url";
  routePath: string;
  feedUrl: string;
  description: string;
  enabled: boolean;
};

const EMPTY_DRAFT: SourceDraft = {
  name: "",
  sourceType: "rss_url",
  routePath: "",
  feedUrl: "",
  description: "",
  enabled: true,
};

const HTML_TAG_PATTERN = /<[a-z][\s\S]*>/i;

function normalizePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodePreviewHtmlEntities(value: string): string {
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const document = parser.parseFromString(value, "text/html");
    return document.documentElement.textContent ?? value;
  }

  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizePreviewMarkup(value?: string | null): string {
  if (!value) {
    return "";
  }

  let normalized = value.trim();
  for (let index = 0; index < 2; index += 1) {
    if (HTML_TAG_PATTERN.test(normalized)) {
      return normalized;
    }
    const decoded = decodePreviewHtmlEntities(normalized).trim();
    if (!decoded || decoded === normalized) {
      return normalized;
    }
    normalized = decoded;
  }

  return normalized;
}

function stripHtmlToPlainText(value?: string | null): string {
  const normalizedValue = normalizePreviewMarkup(value);
  if (!normalizedValue) {
    return "";
  }

  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const document = parser.parseFromString(normalizedValue, "text/html");
    return normalizePreviewText(document.body.textContent ?? "");
  }

  return normalizePreviewText(
    normalizedValue
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function truncatePreviewText(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}

function buildPreviewExcerpt(
  item: RssSourcePreviewDto["items"][number],
  maxLength = 180,
): string | null {
  const raw = item.summary_text || item.content_text;
  const text = stripHtmlToPlainText(raw);
  return text ? truncatePreviewText(text, maxLength) : null;
}

function formatPlainTextAsHtml(value: string): string {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((segment) => normalizePreviewText(segment))
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function sanitizePreviewHtmlNode(node: ChildNode): string {
  if (node.nodeType === 3) {
    return escapeHtml(node.textContent ?? "");
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (
    ["script", "style", "iframe", "img", "video", "audio", "source", "svg", "canvas"].includes(tag)
  ) {
    return "";
  }

  if (tag === "br") {
    return "<br />";
  }

  const content = Array.from(element.childNodes).map(sanitizePreviewHtmlNode).join("");
  const normalizedTag = tag === "b" ? "strong" : tag === "i" ? "em" : tag;

  if (normalizedTag === "a") {
    const href = element.getAttribute("href")?.trim() ?? "";
    const safeHref = /^(https?:|mailto:)/i.test(href) ? href : "";
    if (!content.trim()) {
      return "";
    }
    if (!safeHref) {
      return content;
    }
    return `<a href="${escapeHtmlAttribute(safeHref)}" target="_blank" rel="noreferrer">${content}</a>`;
  }

  if (
    ["p", "strong", "em", "ul", "ol", "li", "blockquote", "code", "pre"].includes(normalizedTag)
  ) {
    if (!content.trim()) {
      return "";
    }
    return `<${normalizedTag}>${content}</${normalizedTag}>`;
  }

  return content;
}

function sanitizePreviewHtml(value?: string | null): string {
  const normalizedValue = normalizePreviewMarkup(value);
  const plainText = stripHtmlToPlainText(normalizedValue);
  const fallback = formatPlainTextAsHtml(plainText);

  if (!normalizedValue) {
    return fallback;
  }

  if (!HTML_TAG_PATTERN.test(normalizedValue)) {
    return fallback;
  }

  if (typeof DOMParser === "undefined") {
    return fallback;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(normalizedValue, "text/html");
  const html = Array.from(document.body.childNodes).map(sanitizePreviewHtmlNode).join("").trim();

  return html || fallback;
}

function sourceStatusTone(
  status: RssSourceDto["status"],
): "online" | "offline" | "warning" | "error" | "muted" {
  if (status === "normal") return "online";
  if (status === "backoff") return "warning";
  if (status === "error") return "error";
  if (status === "disabled") return "offline";
  return "muted";
}

function sourceStatusLabel(status: RssSourceDto["status"]): string {
  if (status === "normal") return "正常";
  if (status === "backoff") return "退避中";
  if (status === "error") return "异常";
  if (status === "disabled") return "停用";
  return status;
}

function createDraft(source?: RssSourceDto | null): SourceDraft {
  if (!source) {
    return EMPTY_DRAFT;
  }

  return {
    id: source.id,
    name: source.name,
    sourceType: source.source_type,
    routePath: source.route_path ?? "",
    feedUrl: source.feed_url ?? "",
    description: source.description ?? "",
    enabled: source.enabled,
  };
}

function SourcePreviewDialog(props: {
  open: boolean;
  preview: RssSourcePreviewDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const items = props.preview?.items ?? [];
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!props.open) {
      setSelectedItemId(null);
      return;
    }

    if (items.length === 0) {
      setSelectedItemId(null);
      return;
    }

    setSelectedItemId((current) =>
      current && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null),
    );
  }, [items, props.open]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? items[0] ?? null;
  const selectedTitle = selectedItem
    ? stripHtmlToPlainText(selectedItem.title) || "未命名条目"
    : "";
  const selectedDetailHtml = selectedItem
    ? sanitizePreviewHtml(
        selectedItem.content_html || selectedItem.content_text || selectedItem.summary_text,
      )
    : "";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="h-160 max-w-6xl rounded-dialog md:h-180">
          <DialogHeader className="flex flex-row items-center justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-4xl md:text-5xl">内容预览</DialogTitle>
              <p className="mt-2 text-base leading-6 text-muted-strong">
                {props.preview?.source.name ?? "未选择订阅源"}
              </p>
            </div>
            <DialogClose className="mt-0.5" />
          </DialogHeader>

          <DialogBody className="min-h-0 overflow-hidden p-0 md:p-0">
            {!props.preview ? (
              <div className="m-5 rounded-panel border border-line bg-pane-74 px-4 py-3 text-base text-muted-strong">
                请选择一个订阅源进行预览。
              </div>
            ) : items.length === 0 ? (
              <div className="m-5 rounded-panel border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
                <SearchIcon className="mx-auto size-8 text-muted" />
                <p className="mt-3 text-xl font-medium text-ink">暂无内容</p>
                <p className="mt-2 text-base leading-6 text-muted">
                  源已连通，但当前没有抓到可展示的新条目。
                </p>
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col md:flex-row">
                <aside className="max-h-56 shrink-0 overflow-y-auto border-b border-line bg-pane-74 md:max-h-none md:w-80 md:border-b-0 md:border-r">
                  {items.map((item) => {
                    const excerpt = buildPreviewExcerpt(item, 88);
                    const title = stripHtmlToPlainText(item.title) || "未命名条目";
                    const active = item.id === selectedItem?.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedItemId(item.id)}
                        className={[
                          "relative flex min-h-28 w-full flex-col overflow-hidden border-b border-line px-4 py-3 text-left transition last:border-b-0",
                          active
                            ? "bg-accent-subtle text-ink shadow-accent-xs"
                            : "text-muted-strong hover:bg-white/72 hover:text-ink",
                        ].join(" ")}
                      >
                        <span
                          aria-hidden="true"
                          className={[
                            "absolute inset-y-3 left-0 w-1 rounded-r-full transition",
                            active ? "bg-accent" : "bg-transparent",
                          ].join(" ")}
                        />
                        <div
                          className={[
                            "line-clamp-1 text-base font-semibold leading-6 transition",
                            active ? "text-accent-strong" : "text-ink",
                          ].join(" ")}
                        >
                          {title}
                        </div>
                        <div className="mt-2 flex-1">
                          {excerpt ? (
                            <p
                              className={[
                                "line-clamp-2 text-sm leading-6 transition",
                                active ? "text-muted-strong" : "text-muted",
                              ].join(" ")}
                            >
                              {excerpt}
                            </p>
                          ) : null}
                        </div>
                        <div
                          className={[
                            "mt-auto pt-2 text-xs transition",
                            active ? "text-accent-strong" : "text-muted",
                          ].join(" ")}
                        >
                          {formatDateTime(item.published_at)}
                          {item.author ? ` · ${item.author}` : ""}
                        </div>
                      </button>
                    );
                  })}
                </aside>

                <section className="min-h-0 flex-1 overflow-y-auto bg-card-hover">
                  {selectedItem ? (
                    <div className="px-5 py-5 md:px-6">
                      <div className="text-sm text-muted">
                        <span>{formatDateTime(selectedItem.published_at)}</span>
                        {selectedItem.author ? <span> · {selectedItem.author}</span> : null}
                      </div>

                      {selectedItem.link ? (
                        <a
                          href={selectedItem.link}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-start gap-1.5 text-4xl font-semibold leading-8 text-ink transition hover:text-accent-strong"
                        >
                          <span className="min-w-0">{selectedTitle}</span>
                          <ArrowRightIcon className="mt-1 size-4 shrink-0 -rotate-45" />
                        </a>
                      ) : (
                        <h4 className="mt-2 text-4xl font-semibold leading-8 text-ink">
                          {selectedTitle}
                        </h4>
                      )}

                      {selectedItem.link ? (
                        <a
                          href={selectedItem.link}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1.5 text-base font-medium text-accent transition hover:text-accent-strong"
                        >
                          <span>查看原文</span>
                          <ArrowRightIcon className="size-3.5 -rotate-45" />
                        </a>
                      ) : null}

                      <div
                        className="rss-preview-richtext mt-6"
                        dangerouslySetInnerHTML={{ __html: selectedDetailHtml }}
                      />
                    </div>
                  ) : null}
                </section>
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function SourceEditorDialog(props: {
  open: boolean;
  draft: SourceDraft;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (draft: SourceDraft) => void;
  onSave: () => void;
}) {
  const editing = Boolean(props.draft.id);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-3xl rounded-dialog">
          <DialogHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <DialogTitle className="text-4xl md:text-5xl">
                {editing ? "编辑订阅源" : "新增订阅源"}
              </DialogTitle>
              <p className="mt-2 text-base leading-6 text-muted-strong">
                支持 RSSHub 路由源与普通 RSS URL 源。
              </p>
            </div>
            <DialogClose className="mt-0.5" />
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">名称</label>
                <Input
                  value={props.draft.name}
                  onChange={(event) => props.onChange({ ...props.draft, name: event.target.value })}
                  placeholder="例如 Newlearner Channel"
                />
              </div>

              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">源类型</label>
                <Select
                  value={props.draft.sourceType}
                  onChange={(value) =>
                    props.onChange({
                      ...props.draft,
                      sourceType: value as SourceDraft["sourceType"],
                    })
                  }
                  options={[
                    { value: "rss_url", label: "普通 RSS URL" },
                    { value: "rsshub_route", label: "RSSHub 路由" },
                  ]}
                />
              </div>
            </div>

            {props.draft.sourceType === "rss_url" ? (
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">Feed URL</label>
                <Input
                  value={props.draft.feedUrl}
                  onChange={(event) =>
                    props.onChange({ ...props.draft, feedUrl: event.target.value })
                  }
                  placeholder="https://example.com/feed.xml"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">RSSHub Route Path</label>
                <Input
                  value={props.draft.routePath}
                  onChange={(event) =>
                    props.onChange({ ...props.draft, routePath: event.target.value })
                  }
                  placeholder="/telegram/channel/NewlearnerChannel"
                />
              </div>
            )}

            <div className="flex flex-col gap-2.5">
              <label className="text-base font-medium text-muted-strong">描述</label>
              <Input
                value={props.draft.description}
                onChange={(event) =>
                  props.onChange({ ...props.draft, description: event.target.value })
                }
                placeholder="用于说明这个源抓什么内容"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={props.draft.enabled ? "online" : "offline"}>
                {props.draft.enabled ? "启用" : "停用"}
              </Badge>
              <Button
                variant="outline"
                onClick={() => props.onChange({ ...props.draft, enabled: !props.draft.enabled })}
              >
                {props.draft.enabled ? "设为停用" : "设为启用"}
              </Button>
            </div>
          </DialogBody>

          <DialogFooter className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              取消
            </Button>
            <Button disabled={props.saving} onClick={props.onSave}>
              {props.saving ? "保存中..." : editing ? "保存变更" : "创建订阅源"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function SourceCard(props: {
  source: RssSourceDto;
  onEdit: () => void;
  onPreview: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="reveal-up group relative rounded-lg border border-card-line bg-glass-90 pb-5 shadow-card-hover transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-accent-border-strong">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white/90 text-muted-strong">
            <RssIcon className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-lg font-semibold tracking-title text-ink">
                {props.source.name}
              </h3>
              <Badge tone={sourceStatusTone(props.source.status)}>
                {sourceStatusLabel(props.source.status)}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-base text-muted">
              {props.source.source_type === "rss_url"
                ? props.source.feed_url
                : props.source.route_path || "未配置路由"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-center">
          <CardToggle
            enabled={props.source.enabled}
            label={props.source.enabled ? "停用订阅源" : "启用订阅源"}
            onToggle={props.onToggle}
          />
          <CardOverflowMenu
            items={[
              {
                label: "预览内容",
                tone: "primary",
                onClick: props.onPreview,
                icon: <SearchIcon className="size-4" />,
              },
              {
                label: "测试抓取",
                tone: "warning",
                onClick: props.onTest,
                icon: <RefreshIcon className="size-4" />,
              },
              {
                label: "编辑",
                tone: "primary",
                onClick: props.onEdit,
                icon: <PencilIcon className="size-4" />,
              },
              {
                label: "删除",
                tone: "danger",
                onClick: props.onDelete,
                icon: <TrashIcon className="size-4" />,
              },
            ]}
          />
        </div>
      </div>

      {props.source.description ? (
        <p className="mt-3 px-5 text-base leading-6 text-muted-strong">
          {props.source.description}
        </p>
      ) : null}

      <div className="px-5">
        <MetricGrid
          items={[
            {
              icon: <RefreshIcon className="size-3.5" />,
              label: "最近抓取",
              value: formatDateTime(props.source.last_fetched_at),
            },
            {
              icon: <LinkIcon className="size-3.5" />,
              label: "任务引用",
              value: formatCount(props.source.referenced_task_count),
            },
          ]}
        />
      </div>

      {props.source.last_error ? (
        <div className="mt-3 mx-5 rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-sm leading-6 text-red-700">
          {props.source.last_error}
        </div>
      ) : null}
    </div>
  );
}

export function RssSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<RssSourcePreviewDto | null>(null);

  const {
    data: sources = [],
    isPending: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.rssSources,
    queryFn: fetchRssSources,
    staleTime: 15_000,
  });

  const filteredSources = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return sources;
    }

    return sources.filter((source) => {
      return (
        source.name.toLowerCase().includes(query) ||
        (source.route_path ?? "").toLowerCase().includes(query) ||
        (source.feed_url ?? "").toLowerCase().includes(query)
      );
    });
  }, [searchQuery, sources]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.rssSources });
  }

  async function handleSave() {
    setSaving(true);

    try {
      if (draft.id) {
        await updateRssSource(draft.id, {
          name: draft.name,
          source_type: draft.sourceType,
          route_path: draft.sourceType === "rsshub_route" ? draft.routePath || null : null,
          feed_url: draft.sourceType === "rss_url" ? draft.feedUrl || null : null,
          description: draft.description || null,
          enabled: draft.enabled,
        });
        toast.success(`${draft.name} 已更新`);
      } else {
        await createRssSource({
          name: draft.name,
          source_type: draft.sourceType,
          route_path: draft.sourceType === "rsshub_route" ? draft.routePath || null : null,
          feed_url: draft.sourceType === "rss_url" ? draft.feedUrl || null : null,
          description: draft.description || null,
          enabled: draft.enabled,
        });
        toast.success(`${draft.name} 已创建`);
      }

      setEditorOpen(false);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (saveIssue) {
      toast.error(saveIssue instanceof Error ? saveIssue.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview(source: RssSourceDto, test = false) {
    try {
      const nextPreview = test ? await testRssSource(source.id) : await previewRssSource(source.id);
      setPreview(nextPreview);
      setPreviewOpen(true);
      await refresh();
      if (test) {
        toast.success(`${source.name} 抓取测试完成`);
      }
    } catch (previewIssue) {
      toast.error(previewIssue instanceof Error ? previewIssue.message : "预览失败");
    }
  }

  async function handleDelete(source: RssSourceDto) {
    if (!window.confirm(`确定删除订阅源「${source.name}」吗？`)) {
      return;
    }

    try {
      await deleteRssSource(source.id);
      toast.success(`${source.name} 已删除`);
      await refresh();
    } catch (deleteIssue) {
      toast.error(deleteIssue instanceof Error ? deleteIssue.message : "删除失败");
    }
  }

  const stats = useMemo(() => {
    return {
      total: sources.length,
      active: sources.filter((source) => source.enabled).length,
      error: sources.filter((source) => source.status === "error").length,
      referenced: sources.reduce((sum, source) => sum + source.referenced_task_count, 0),
    };
  }, [sources]);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">RSS Sources</p>
            <h2 className="mt-1.5 text-6xl text-ink">RSS 订阅</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void refresh()}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
            <Button
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setEditorOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              新增订阅源
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="muted">总数 {formatCount(stats.total)}</Badge>
          <Badge tone="online">启用 {formatCount(stats.active)}</Badge>
          <Badge tone="error">异常 {formatCount(stats.error)}</Badge>
          <Badge tone="muted">被任务引用 {formatCount(stats.referenced)}</Badge>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索名称、路由或 URL..."
          />
          <span className="inline-flex size-10 items-center justify-center rounded-card border border-line bg-panel-strong text-muted-strong">
            <SearchIcon className="size-4" />
          </span>
        </div>
      </section>

      {error ? (
        <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载订阅源失败：{error instanceof Error ? error.message : String(error)}
        </div>
      ) : null}

      {loading ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-line bg-glass-80 px-5 py-5">
              <div className="ui-skeleton h-5 rounded-lg" />
              <div className="mt-3 ui-skeleton h-4 rounded-lg" />
              <div className="mt-4 ui-skeleton h-20 rounded-lg" />
            </div>
          ))}
        </section>
      ) : null}

      {!loading && filteredSources.length === 0 ? (
        <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
          <LinkIcon className="mx-auto size-8 text-muted" />
          <p className="mt-3 text-xl font-medium text-ink">暂无订阅源</p>
          <p className="mt-2 text-base leading-6 text-muted">
            先添加一个 RSS 地址或 RSSHub 路由开始采集。
          </p>
        </section>
      ) : null}

      {!loading && filteredSources.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {filteredSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              onEdit={() => {
                setDraft(createDraft(source));
                setEditorOpen(true);
              }}
              onPreview={() => void handlePreview(source, false)}
              onTest={() => void handlePreview(source, true)}
              onToggle={async () => {
                try {
                  await updateRssSource(source.id, { enabled: !source.enabled });
                  toast.success(`${source.name} 已${source.enabled ? "停用" : "启用"}`);
                  await refresh();
                } catch (toggleIssue) {
                  toast.error(toggleIssue instanceof Error ? toggleIssue.message : "更新失败");
                }
              }}
              onDelete={() => void handleDelete(source)}
            />
          ))}
        </section>
      ) : null}

      <SourceEditorDialog
        open={editorOpen}
        draft={draft}
        saving={saving}
        onOpenChange={setEditorOpen}
        onChange={setDraft}
        onSave={() => void handleSave()}
      />
      <SourcePreviewDialog open={previewOpen} preview={preview} onOpenChange={setPreviewOpen} />
    </div>
  );
}
