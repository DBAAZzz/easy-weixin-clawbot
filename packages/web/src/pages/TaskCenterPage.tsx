import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { AccountSummary } from "@clawbot/shared";
import {
  createRssTask,
  deleteRssTask,
  fetchRssSources,
  fetchRssTasks,
  previewRssTask,
  runRssTaskNow,
  updateRssTask,
  type RssTaskDto,
  type RssTaskPreviewDto,
} from "@/api/rss.js";
import { fetchScheduledTaskRuns, toggleScheduledTask } from "@/api/scheduled-tasks.js";
import { useAccounts } from "../hooks/useAccounts.js";
import { CardOverflowMenu, CardToggle, IconTag, MetricGrid } from "../components/ui/admin-card.js";
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
import {
  ClockIcon,
  HistoryIcon,
  LinkIcon,
  PauseIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  RssIcon,
  StackIcon,
  TrashIcon,
} from "../components/ui/icons.js";
import { queryKeys } from "../lib/query-keys.js";
import { cn } from "../lib/cn.js";
import { formatCount, formatDateTime, formatDuration } from "../lib/format.js";

type TaskDraft = {
  accountId: string;
  name: string;
  taskKind: "rss_digest" | "rss_brief";
  cronPreset: string;
  cron: string;
  timezone: string;
  maxItems: string;
  enabled: boolean;
  type: "once" | "recurring";
  silentWindowEnabled: boolean;
  silentStart: string;
  silentEnd: string;
  sourceIds: string[];
};

const CRON_PRESETS = [
  { value: "*/5 * * * *", label: "每 5 分钟" },
  { value: "*/15 * * * *", label: "每 15 分钟" },
  { value: "*/30 * * * *", label: "每 30 分钟" },
  { value: "0 * * * *", label: "每 1 小时" },
  { value: "0 9 * * *", label: "每天 09:00" },
  { value: "custom", label: "自定义 Cron" },
] as const;

const EMPTY_TASK_DRAFT: TaskDraft = {
  accountId: "",
  name: "",
  taskKind: "rss_brief",
  cronPreset: "*/15 * * * *",
  cron: "*/15 * * * *",
  timezone: "Asia/Shanghai",
  maxItems: "4",
  enabled: true,
  type: "recurring",
  silentWindowEnabled: false,
  silentStart: "23:00",
  silentEnd: "08:00",
  sourceIds: [],
};

function taskKindLabel(taskKind: RssTaskDto["task_kind"]): string {
  return taskKind === "rss_digest" ? "摘要任务" : "快讯任务";
}

function taskStatusTone(
  status: RssTaskDto["status"],
): "online" | "offline" | "warning" | "error" | "muted" {
  if (status === "running") return "warning";
  if (status === "error") return "error";
  if (status === "paused") return "offline";
  if (status === "idle") return "online";
  return "muted";
}

function taskStatusLabel(status: RssTaskDto["status"]): string {
  if (status === "running") return "执行中";
  if (status === "error") return "异常";
  if (status === "paused") return "已暂停";
  if (status === "idle") return "待执行";
  return status;
}

function taskExecutionLabel(type: RssTaskDto["type"]): string {
  return type === "once" ? "仅执行一次" : "循环执行";
}

function scheduleLabel(cron: string): string {
  return CRON_PRESETS.find((preset) => preset.value === cron)?.label ?? "自定义 Cron";
}

function accountLabel(account: AccountSummary | undefined, accountId: string): string {
  return account?.alias?.trim() || account?.display_name?.trim() || accountId;
}

function createTaskDraft(task?: RssTaskDto | null): TaskDraft {
  if (!task) {
    return EMPTY_TASK_DRAFT;
  }

  const cronPreset = CRON_PRESETS.find((item) => item.value === task.cron)?.value ?? "custom";

  return {
    accountId: task.account_id,
    name: task.name,
    taskKind: task.task_kind,
    cronPreset,
    cron: task.cron,
    timezone: task.timezone,
    maxItems: String(task.max_items),
    enabled: task.enabled,
    type: task.type,
    silentWindowEnabled: Boolean(task.silent_window),
    silentStart: task.silent_window?.start ?? "23:00",
    silentEnd: task.silent_window?.end ?? "08:00",
    sourceIds: task.sources.map((source) => source.id),
  };
}

function RunsDialog(props: {
  open: boolean;
  accountId: string;
  seq: number;
  taskName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: runs = [], isPending } = useQuery({
    queryKey: queryKeys.scheduledTaskRuns(props.accountId, props.seq),
    queryFn: () => fetchScheduledTaskRuns(props.accountId, props.seq, 20),
    enabled: props.open,
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-dialog">
          <DialogHeader className="flex flex-row items-center justify-between gap-4">
            <div>
              <DialogTitle className="text-4xl md:text-5xl">执行历史</DialogTitle>
              <p className="mt-2 text-base leading-6 text-muted-strong">{props.taskName}</p>
            </div>
            <DialogClose className="mt-0.5" />
          </DialogHeader>

          <DialogBody className="flex flex-col gap-3">
            {isPending ? (
              <div className="rounded-panel border border-line bg-pane-74 px-4 py-3 text-base text-muted-strong">
                正在加载执行历史…
              </div>
            ) : runs.length === 0 ? (
              <div className="rounded-panel border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
                <ClockIcon className="mx-auto size-8 text-muted" />
                <p className="mt-3 text-xl font-medium text-ink">暂无执行记录</p>
              </div>
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          run.status === "success"
                            ? "online"
                            : run.status === "skipped"
                              ? "warning"
                              : "error"
                        }
                      >
                        {run.status}
                      </Badge>
                      <Badge tone="muted">{formatDateTime(run.createdAt)}</Badge>
                    </div>
                    <Badge tone="muted">耗时 {formatDuration(run.durationMs)}</Badge>
                  </div>
                  {run.result ? (
                    <pre className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-strong">
                      {run.result}
                    </pre>
                  ) : null}
                  {run.error ? (
                    <div className="mt-3 rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-sm leading-6 text-red-700">
                      {run.error}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function PreviewDialog(props: {
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

function TaskEditorDialog(props: {
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
                  variant="outline"
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
                      variant={selected ? "primary" : "outline"}
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
            <Button variant="outline" onClick={() => props.onOpenChange(false)}>
              取消
            </Button>
            <Button disabled={props.saving} onClick={props.onSave}>
              {props.saving ? "保存中..." : props.editing ? "保存变更" : "创建任务"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function TaskCard(props: {
  task: RssTaskDto;
  account: AccountSummary | undefined;
  onPreview: () => void;
  onRuns: () => void;
  onRunNow: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const accountName = accountLabel(props.account, props.task.account_id);

  return (
    <div className="reveal-up group relative rounded-lg border border-card-line bg-glass-90 pb-4 shadow-card-hover transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-accent-border-strong">
      <div className="px-5 pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                props.task.task_kind === "rss_digest"
                  ? "border-accent-border bg-accent-subtle text-accent"
                  : "border-slate-border-soft bg-pane-90 text-muted-strong",
              )}
            >
              <RssIcon className="size-5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="truncate text-lg font-semibold tracking-title text-ink">
                  {props.task.name}
                </h3>
                <Badge tone={taskStatusTone(props.task.status)}>
                  {taskStatusLabel(props.task.status)}
                </Badge>
                <Badge tone="muted">{taskKindLabel(props.task.task_kind)}</Badge>
              </div>
              <p className="mt-0.5 text-base text-muted">
                {accountName} · {props.task.timezone}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <CardToggle
              enabled={props.task.enabled}
              label={props.task.enabled ? "暂停任务" : "恢复任务"}
              onToggle={props.onToggle}
            />
            <CardOverflowMenu
              items={[
                {
                  label: "预览",
                  tone: "primary",
                  onClick: props.onPreview,
                  icon: <ClockIcon className="size-4" />,
                },
                {
                  label: "立即执行",
                  tone: "primary",
                  onClick: props.onRunNow,
                  icon: <RefreshIcon className="size-4" />,
                },
                {
                  label: "执行历史",
                  tone: "primary",
                  onClick: props.onRuns,
                  icon: <HistoryIcon className="size-4" />,
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
      </div>

      <div className="px-5">
        <MetricGrid
          items={[
            {
              icon: <ClockIcon className="size-3.5" />,
              label: "调度",
              value: scheduleLabel(props.task.cron),
            },
            {
              icon: <StackIcon className="size-3.5" />,
              label: "执行方式",
              value: taskExecutionLabel(props.task.type),
            },
          ]}
        />
      </div>

      {props.task.silent_window || props.task.last_error ? (
        <div className="px-5">
          {props.task.silent_window ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <IconTag icon={<PauseIcon className="size-3" />} tone="warning">
                静默 {props.task.silent_window.start} - {props.task.silent_window.end}
              </IconTag>
            </div>
          ) : null}

          {props.task.last_error ? (
            <div className="mt-3 rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-sm leading-6 text-red-700">
              {props.task.last_error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function TaskCenterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { accounts } = useAccounts();
  const accountIdFilter = searchParams.get("accountId") ?? undefined;
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [editingTask, setEditingTask] = useState<RssTaskDto | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [preview, setPreview] = useState<RssTaskPreviewDto | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [runsTask, setRunsTask] = useState<RssTaskDto | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    data: tasks = [],
    isPending: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.rssTasks(accountIdFilter),
    queryFn: () => fetchRssTasks(accountIdFilter),
    staleTime: 15_000,
  });

  const { data: sources = [] } = useQuery({
    queryKey: queryKeys.rssSources,
    queryFn: fetchRssSources,
    staleTime: 15_000,
  });

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return tasks;
    }

    return tasks.filter((task) => {
      return (
        task.name.toLowerCase().includes(query) ||
        task.account_id.toLowerCase().includes(query) ||
        task.sources.some((source) => source.name.toLowerCase().includes(query))
      );
    });
  }, [searchQuery, tasks]);

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ id: source.id, name: source.name })),
    [sources],
  );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.rssTasks(accountIdFilter) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.rssSources });
  }

  async function handleSave() {
    setSaving(true);

    try {
      const payload = {
        account_id: draft.accountId,
        name: draft.name,
        task_kind: draft.taskKind,
        cron: draft.cronPreset === "custom" ? draft.cron : draft.cronPreset,
        timezone: draft.timezone,
        source_ids: draft.sourceIds,
        max_items: Number.parseInt(draft.maxItems, 10),
        enabled: draft.enabled,
        type: draft.type,
        silent_window: draft.silentWindowEnabled
          ? { start: draft.silentStart, end: draft.silentEnd }
          : null,
      };

      if (editingTask) {
        await updateRssTask(editingTask.account_id, editingTask.seq, payload);
        toast.success(`${draft.name} 已更新`);
      } else {
        await createRssTask(payload);
        toast.success(`${draft.name} 已创建`);
      }

      setEditorOpen(false);
      setEditingTask(null);
      setDraft(EMPTY_TASK_DRAFT);
      await refresh();
    } catch (saveIssue) {
      toast.error(saveIssue instanceof Error ? saveIssue.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function openPreview(task: RssTaskDto) {
    try {
      const nextPreview = await previewRssTask(task.account_id, task.seq);
      setPreview(nextPreview);
      setPreviewOpen(true);
    } catch (previewIssue) {
      toast.error(previewIssue instanceof Error ? previewIssue.message : "预览失败");
    }
  }

  async function handleRunNow(task: RssTaskDto) {
    try {
      const result = await runRssTaskNow(task.account_id, task.seq);
      toast.success(
        result.run?.status === "success" ? `${task.name} 执行成功` : `${task.name} 已执行`,
      );
      await refresh();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.scheduledTaskRuns(task.account_id, task.seq),
      });
    } catch (runIssue) {
      toast.error(runIssue instanceof Error ? runIssue.message : "执行失败");
    }
  }

  async function handleDelete(task: RssTaskDto) {
    if (!window.confirm(`确定删除任务「${task.name}」吗？`)) {
      return;
    }

    try {
      await deleteRssTask(task.account_id, task.seq);
      toast.success(`${task.name} 已删除`);
      await refresh();
    } catch (deleteIssue) {
      toast.error(deleteIssue instanceof Error ? deleteIssue.message : "删除失败");
    }
  }

  const stats = useMemo(() => {
    return {
      total: tasks.length,
      enabled: tasks.filter((task) => task.enabled).length,
      running: tasks.filter((task) => task.status === "running").length,
      errors: tasks.filter((task) => task.status === "error").length,
    };
  }, [tasks]);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Task Center</p>
            <h2 className="mt-1.5 text-6xl text-ink">任务中心</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void refresh()}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
            <Button
              onClick={() => {
                setEditingTask(null);
                setDraft({
                  ...EMPTY_TASK_DRAFT,
                  accountId: accountIdFilter ?? accounts[0]?.id ?? "",
                });
                setEditorOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              新建任务
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="muted">总数 {formatCount(stats.total)}</Badge>
          <Badge tone="online">启用 {formatCount(stats.enabled)}</Badge>
          <Badge tone="warning">运行中 {formatCount(stats.running)}</Badge>
          <Badge tone="error">异常 {formatCount(stats.errors)}</Badge>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_160px]">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索任务名称、账号或订阅源..."
          />
          <Select
            value={accountIdFilter ?? "all"}
            onChange={(value) => {
              if (value === "all") {
                setSearchParams({});
                return;
              }
              setSearchParams({ accountId: value });
            }}
            options={[
              { value: "all", label: "全部账号" },
              ...accounts.map((account) => ({
                value: account.id,
                label: account.alias || account.display_name || account.id,
              })),
            ]}
          />
          <Button variant="outline" onClick={() => navigate("/rss-subscriptions")}>
            <LinkIcon className="size-4" />
            管理订阅
          </Button>
        </div>
      </section>

      {error ? (
        <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载任务失败：{error instanceof Error ? error.message : String(error)}
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

      {!loading && filteredTasks.length === 0 ? (
        <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
          <StackIcon className="mx-auto size-8 text-muted" />
          <p className="mt-3 text-xl font-medium text-ink">暂无 RSS 任务</p>
          <p className="mt-2 text-base leading-6 text-muted">
            先配置订阅源，再创建快讯任务或摘要任务。
          </p>
        </section>
      ) : null}

      {!loading && filteredTasks.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              account={accounts.find((account) => account.id === task.account_id)}
              onPreview={() => void openPreview(task)}
              onRuns={() => setRunsTask(task)}
              onRunNow={() => void handleRunNow(task)}
              onEdit={() => {
                setEditingTask(task);
                setDraft(createTaskDraft(task));
                setEditorOpen(true);
              }}
              onToggle={async () => {
                try {
                  await toggleScheduledTask(task.account_id, task.seq, !task.enabled);
                  toast.success(`${task.name} 已${task.enabled ? "暂停" : "恢复"}`);
                  await refresh();
                } catch (toggleIssue) {
                  toast.error(toggleIssue instanceof Error ? toggleIssue.message : "更新失败");
                }
              }}
              onDelete={() => void handleDelete(task)}
            />
          ))}
        </section>
      ) : null}

      <TaskEditorDialog
        open={editorOpen}
        draft={draft}
        accounts={accounts}
        sourceOptions={sourceOptions}
        saving={saving}
        editing={Boolean(editingTask)}
        onOpenChange={setEditorOpen}
        onChange={setDraft}
        onSave={() => void handleSave()}
      />
      <PreviewDialog open={previewOpen} preview={preview} onOpenChange={setPreviewOpen} />
      <RunsDialog
        open={Boolean(runsTask)}
        accountId={runsTask?.account_id ?? ""}
        seq={runsTask?.seq ?? 0}
        taskName={runsTask?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setRunsTask(null);
          }
        }}
      />
    </div>
  );
}
