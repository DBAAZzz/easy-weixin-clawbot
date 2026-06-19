import { useEffect, useState } from "react";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@clawbot/ui";
import { SearchIcon, ArrowRightIcon } from "@clawbot/ui";
import type { RssSourcePreviewDto } from "@/api/rss.js";
import { formatDateTime } from "../../lib/format.js";
import { stripHtmlToPlainText, sanitizePreviewHtml, buildPreviewExcerpt } from "./types.js";

export function SourcePreviewDialog(props: {
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
        <DialogContent className="rss-preview-dialog rounded-dialog">
          <DialogHeader status={<DialogClose />}>
            <div className="min-w-0">
              <DialogTitle className="text-4xl md:text-5xl">内容预览</DialogTitle>
              <p className="mt-2 text-base leading-6 text-muted-strong">
                {props.preview?.source.name ?? "未选择订阅源"}
              </p>
            </div>
          </DialogHeader>

          <DialogBody className="min-h-0 flex-1 overflow-hidden px-0 md:p-0">
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
              <div className="rss-preview-layout">
                <aside className="rss-preview-list border-b border-line bg-pane-74 md:border-b-0 md:border-r">
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
                          "relative flex min-h-28 w-full min-w-0 flex-col overflow-hidden border-b border-line px-4 py-3 text-left transition last:border-b-0",
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
                            "line-clamp-1 min-w-0 text-base font-semibold leading-6 transition",
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

                <section className="rss-preview-detail bg-card-hover">
                  {selectedItem ? (
                    <div className="min-w-0 px-5 py-5 md:px-6">
                      <div className="text-sm text-muted">
                        <span>{formatDateTime(selectedItem.published_at)}</span>
                        {selectedItem.author ? <span> · {selectedItem.author}</span> : null}
                      </div>

                      {selectedItem.link ? (
                        <a
                          href={selectedItem.link}
                          target="_blank"
                          rel="noreferrer"
                          className="rss-preview-title mt-2 flex max-w-full items-start gap-1.5 text-4xl font-semibold leading-8 text-ink transition hover:text-accent-strong"
                        >
                          <span className="min-w-0 flex-1">{selectedTitle}</span>
                          <ArrowRightIcon className="mt-1 size-4 shrink-0 -rotate-45" />
                        </a>
                      ) : (
                        <h4 className="rss-preview-title mt-2 text-4xl font-semibold leading-8 text-ink">
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
