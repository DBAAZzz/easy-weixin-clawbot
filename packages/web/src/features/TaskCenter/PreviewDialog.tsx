import type { RssTaskPreviewDto } from "@/api/rss.js";
import { Badge } from "@clawbot/ui";
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
import { formatCount, formatDateTime } from "../../lib/format.js";

export function PreviewDialog(props: {
  open: boolean;
  preview: RssTaskPreviewDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-dialog">
          <DialogHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <DialogTitle className="text-4xl md:text-5xl">任务预览</DialogTitle>
              <p className="mt-2 text-base leading-6 text-muted-strong">
                {props.preview?.task.name ?? "未选择任务"}
              </p>
            </div>
            <DialogClose className="mt-0.5" />
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
            {!props.preview ? (
              <div className="rounded-panel border border-line bg-pane-74 px-4 py-3 text-base text-muted-strong">
                请选择一个任务进行预览。
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={props.preview.would_send ? "online" : "warning"}>
                    {props.preview.would_send ? "本次会发送" : "本次不会发送"}
                  </Badge>
                  <Badge tone="muted">候选内容 {formatCount(props.preview.item_count)}</Badge>
                  {props.preview.dropped_count > 0 ? (
                    <Badge tone="warning">
                      超额忽略 {formatCount(props.preview.dropped_count)}
                    </Badge>
                  ) : null}
                </div>
                {props.preview.reason ? (
                  <div className="rounded-panel border border-line bg-pane-74 px-4 py-3 text-base leading-6 text-muted-strong">
                    {props.preview.reason}
                  </div>
                ) : null}
                {props.preview.content ? (
                  <div className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card">
                    <p className="text-sm font-medium text-muted-strong">发送内容</p>
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">
                      {props.preview.content}
                    </pre>
                  </div>
                ) : null}
                <div className="flex flex-col gap-3">
                  {props.preview.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="muted">{formatDateTime(item.published_at)}</Badge>
                        {item.author ? <Badge tone="muted">{item.author}</Badge> : null}
                      </div>
                      <h4 className="mt-3 text-lg font-semibold text-ink">{item.title}</h4>
                      {item.summary_text ? (
                        <p className="mt-2 text-base leading-6 text-muted-strong">
                          {item.summary_text}
                        </p>
                      ) : item.content_text ? (
                        <p className="mt-2 text-base leading-6 text-muted-strong">
                          {item.content_text}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
