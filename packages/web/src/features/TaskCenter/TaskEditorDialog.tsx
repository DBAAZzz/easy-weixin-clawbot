import type { AccountSummary } from "@clawbot/shared";
import { Badge } from "@clawbot/ui";
import { Button } from "@clawbot/ui";
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
} from "@clawbot/ui";
import { Input } from "@clawbot/ui";
import { Select } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { CRON_PRESETS, type TaskDraft } from "./types.js";

export function TaskEditorDialog(props: {
  open: boolean;
  draft: TaskDraft;
  accounts: AccountSummary[];
  sourceOptions: Array<{ id: string; name: string }>;
  saving: boolean;
  editing: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (draft: TaskDraft) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-dialog">
          <DialogHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <DialogTitle className="text-4xl md:text-5xl">
                {props.editing ? "编辑 RSS 任务" : "新建 RSS 任务"}
              </DialogTitle>
              <p className="mt-2 text-base leading-6 text-muted-strong">
                绑定账号、订阅源、执行频率和静默时段。
              </p>
            </div>
            <DialogClose className="mt-0.5" />
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">任务名称</label>
                <Input
                  value={props.draft.name}
                  onChange={(event) => props.onChange({ ...props.draft, name: event.target.value })}
                  placeholder="例如 Newlearner 快讯"
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">绑定账号</label>
                <Select
                  size="sm"
                  value={props.draft.accountId}
                  onChange={(value) => props.onChange({ ...props.draft, accountId: value })}
                  options={props.accounts.map((account) => ({
                    value: account.id,
                    label: account.alias || account.display_name || account.id,
                  }))}
                  placeholder="选择账号"
                  disabled={props.editing}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">任务类型</label>
                <Select
                  size="sm"
                  value={props.draft.taskKind}
                  onChange={(value) =>
                    props.onChange({
                      ...props.draft,
                      taskKind: value as TaskDraft["taskKind"],
                      maxItems: value === "rss_digest" ? "8" : "4",
                    })
                  }
                  options={[
                    { value: "rss_brief", label: "快讯任务" },
                    { value: "rss_digest", label: "摘要任务" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">频率预设</label>
                <Select
                  size="sm"
                  value={props.draft.cronPreset}
                  onChange={(value) =>
                    props.onChange({
                      ...props.draft,
                      cronPreset: value,
                      cron: value === "custom" ? props.draft.cron : value,
                    })
                  }
                  options={CRON_PRESETS.map((preset) => ({
                    value: preset.value,
                    label: preset.label,
                  }))}
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">最大条数</label>
                <Input
                  type="number"
                  value={props.draft.maxItems}
                  onChange={(event) =>
                    props.onChange({ ...props.draft, maxItems: event.target.value })
                  }
                  placeholder="4"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">Cron 表达式</label>
                <Input
                  value={props.draft.cron}
                  onChange={(event) =>
                    props.onChange({
                      ...props.draft,
                      cron: event.target.value,
                      cronPreset: "custom",
                    })
                  }
                  placeholder="*/15 * * * *"
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">时区</label>
                <Input
                  value={props.draft.timezone}
                  onChange={(event) =>
                    props.onChange({ ...props.draft, timezone: event.target.value })
                  }
                  placeholder="Asia/Shanghai"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">执行方式</label>
                <Select
                  size="sm"
                  value={props.draft.type}
                  onChange={(value) =>
                    props.onChange({ ...props.draft, type: value as TaskDraft["type"] })
                  }
                  options={[
                    { value: "recurring", label: "循环执行" },
                    { value: "once", label: "仅执行一次" },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-2.5">
                <label className="text-base font-medium text-muted-strong">任务状态</label>
                <Select
                  size="sm"
                  value={props.draft.enabled ? "enabled" : "disabled"}
                  onChange={(value) =>
                    props.onChange({ ...props.draft, enabled: value === "enabled" })
                  }
                  options={[
                    { value: "enabled", label: "启用" },
                    { value: "disabled", label: "停用" },
                  ]}
                />
              </div>
            </div>

            <div className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-medium text-ink">静默时段</p>
                  <p className="mt-1 text-sm leading-6 text-muted-strong">
                    静默时段内继续采集，但不主动推送。
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    props.onChange({
                      ...props.draft,
                      silentWindowEnabled: !props.draft.silentWindowEnabled,
                    })
                  }
                >
                  {props.draft.silentWindowEnabled ? "关闭静默" : "开启静默"}
                </Button>
              </div>

              {props.draft.silentWindowEnabled ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">开始时间</label>
                    <Input
                      value={props.draft.silentStart}
                      onChange={(event) =>
                        props.onChange({ ...props.draft, silentStart: event.target.value })
                      }
                      placeholder="23:00"
                    />
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <label className="text-base font-medium text-muted-strong">结束时间</label>
                    <Input
                      value={props.draft.silentEnd}
                      onChange={(event) =>
                        props.onChange({ ...props.draft, silentEnd: event.target.value })
                      }
                      placeholder="08:00"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-medium text-ink">订阅源选择</p>
                  <p className="mt-1 text-sm leading-6 text-muted-strong">
                    至少选择一个订阅源，可多选。
                  </p>
                </div>
                <Badge tone="muted">已选 {formatCount(props.draft.sourceIds.length)}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {props.sourceOptions.map((source) => {
                  const selected = props.draft.sourceIds.includes(source.id);
                  return (
                    <Button
                      key={source.id}
                      variant={selected ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => {
                        props.onChange({
                          ...props.draft,
                          sourceIds: selected
                            ? props.draft.sourceIds.filter((item) => item !== source.id)
                            : [...props.draft.sourceIds, source.id],
                        });
                      }}
                    >
                      {source.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          </DialogBody>

          <DialogFooter className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => props.onOpenChange(false)}>
              取消
            </Button>
            <Button size="sm" disabled={props.saving} onClick={props.onSave}>
              {props.saving ? "保存中..." : props.editing ? "保存变更" : "创建任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
