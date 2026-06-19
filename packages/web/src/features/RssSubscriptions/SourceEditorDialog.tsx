import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  Input,
  Select,
} from "@clawbot/ui";
import type { SourceDraft } from "./types.js";

export function SourceEditorDialog(props: {
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
                  size="sm"
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
                size="sm"
                variant="secondary"
                onClick={() => props.onChange({ ...props.draft, enabled: !props.draft.enabled })}
              >
                {props.draft.enabled ? "设为停用" : "设为启用"}
              </Button>
            </div>
          </DialogBody>

          <DialogFooter className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => props.onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" disabled={props.saving} onClick={props.onSave}>
              {props.saving ? "保存中..." : editing ? "保存变更" : "创建订阅源"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
