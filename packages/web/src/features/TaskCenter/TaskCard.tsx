import type { AccountSummary } from "@clawbot/shared";
import type { RssTaskDto } from "@/api/rss.js";
import { CardOverflowMenu, IconTag, MetricGrid, CardToggle } from "@clawbot/ui";
import { Badge } from "@clawbot/ui";
import {
  ClockIcon,
  HistoryIcon,
  PauseIcon,
  PencilIcon,
  RefreshIcon,
  RssIcon,
  StackIcon,
  TrashIcon,
} from "@clawbot/ui";
import { cn } from "../../lib/cn.js";
import {
  accountLabel,
  scheduleLabel,
  taskExecutionLabel,
  taskKindLabel,
  taskStatusLabel,
  taskStatusTone,
} from "./types.js";

export function TaskCard(props: {
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
