import { Badge, Button, Input } from "@clawbot/ui";
import { LinkIcon, PlusIcon, RefreshIcon, SearchIcon } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { createDraft, EMPTY_DRAFT } from "./types.js";
import { useRssSubscriptions } from "./useRssSubscriptions.js";
import { SourceCard } from "./SourceCard.js";
import { SourceEditorDialog } from "./SourceEditorDialog.js";
import { SourcePreviewDialog } from "./SourcePreviewDialog.js";

export function RssSubscriptionsPage() {
  const {
    loading,
    error,
    searchQuery,
    setSearchQuery,
    filteredSources,
    stats,
    editorOpen,
    setEditorOpen,
    previewOpen,
    setPreviewOpen,
    saving,
    draft,
    setDraft,
    preview,
    refresh,
    handleSave,
    handlePreview,
    handleDelete,
    handleToggle,
  } = useRssSubscriptions();

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">RSS Sources</p>
            <h2 className="mt-1.5 text-6xl text-ink">RSS 订阅</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
            <Button
              size="sm"
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
              onToggle={() => void handleToggle(source)}
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
