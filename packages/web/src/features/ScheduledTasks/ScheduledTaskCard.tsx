import { useState, useMemo } from "react";
import {
  CardOverflowMenu,
  CardToggle,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  HistoryIcon,
  ActivityIcon,
  RefreshIcon,
  MetricGrid,
  IconTag,
  StackIcon,
  LayersIcon,
  AlertCircleIcon,
} from "@clawbot/ui";
import { toggleScheduledTask } from "@/api/scheduled-tasks.js";
import type { ScheduledTaskDto } from "@/api/scheduled-tasks.js";
import type { AccountSummary } from "@clawbot/shared";
import { cn } from "../../lib/cn.js";
import { formatCount, formatDateTime } from "../../lib/format.js";
import { cronToHuman, getTaskStatusTone, getTaskStatusLabel, getTaskStatusIcon } from "./types.js";
import { TaskRunsModal } from "./TaskRunsModal.js";

export function ScheduledTaskCard({
  task,
  account,
  expanded,
  onToggleExpand,
  onRefresh,
}: {
  task: ScheduledTaskDto;
  account: AccountSummary | undefined;
  expanded: boolean;
  onToggleExpand: () => void;
  onRefresh: () => void;
}) {
  const [showRuns, setShowRuns] = useState(false);
  const [toggling, setToggling] = useState(false);

  const accountLabel = account?.alias || account?.display_name || task.accountId.slice(0, 12);

  const nextRunText = useMemo(() => {
    if (!task.nextRunAt) return "未调度";
    const next = new Date(task.nextRunAt);
    const now = new Date();
    const diff = next.getTime() - now.getTime();
    if (diff < 0) return "待执行";
    if (diff < 60 * 1000) return "即将执行";
    return formatDateTime(task.nextRunAt);
  }, [task.nextRunAt]);

  const scheduleLabel = cronToHuman(task.cron);

  return (
    <>
      <div
        className={cn(
          "reveal-up group relative rounded-lg border border-card-line bg-card-bg shadow-elevation transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover",
          expanded && "border-notice-success-border bg-card-hover",
        )}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-lg border transition",
              task.enabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : "border-line bg-slate-wash-soft text-muted",
            )}
          >
            <ClockIcon className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-lg font-semibold tracking-title text-ink">
                {task.name}
              </span>
              <span className="text-sm text-muted">#{task.seq}</span>
            </div>
            <p className="mt-0.5 truncate text-base text-muted">
              {accountLabel} · {task.conversationId}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-start">
            <CardToggle
              enabled={task.enabled}
              busy={toggling}
              label={task.enabled ? "暂停定时任务" : "启用定时任务"}
              onToggle={async () => {
                setToggling(true);
                try {
                  await toggleScheduledTask(task.accountId, task.seq, !task.enabled);
                  onRefresh();
                } catch (err) {
                  console.error("[ScheduledTasks] toggle failed:", err);
                } finally {
                  setToggling(false);
                }
              }}
            />
            <CardOverflowMenu
              items={[
                {
                  label: "查看运行记录",
                  tone: "primary",
                  onClick: () => setShowRuns(true),
                  icon: <HistoryIcon className="size-4" />,
                },
                {
                  label: expanded ? "收起详情" : "展开详情",
                  onClick: onToggleExpand,
                  icon: expanded ? (
                    <ChevronUpIcon className="size-4" />
                  ) : (
                    <ChevronDownIcon className="size-4" />
                  ),
                },
              ]}
            />
          </div>
        </div>

        <div className="px-5">
          <MetricGrid
            items={[
              {
                icon: <ClockIcon className="size-3.5" />,
                label: "下次运行",
                value: nextRunText,
              },
              {
                icon: <RefreshIcon className="size-3.5" />,
                label: "执行周期",
                value: scheduleLabel,
              },
              {
                icon: <HistoryIcon className="size-3.5" />,
                label: "上次运行",
                value: task.lastRunAt ? formatDateTime(task.lastRunAt) : "—",
              },
              {
                icon: <ActivityIcon className="size-3.5" />,
                label: "运行次数",
                value: `${formatCount(task.runCount)} 次`,
              },
            ]}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5 px-5 pb-4">
          <IconTag
            icon={<StackIcon className="size-3" />}
            tone={task.type === "once" ? "warning" : "muted"}
          >
            {task.type === "once" ? "单次" : "重复"}
          </IconTag>
          <IconTag icon={getTaskStatusIcon(task.status)} tone={getTaskStatusTone(task.status)}>
            {getTaskStatusLabel(task.status)}
          </IconTag>
          <IconTag icon={<LayersIcon className="size-3" />}>时区 {task.timezone}</IconTag>
          {task.failStreak > 0 ? (
            <IconTag icon={<AlertCircleIcon className="size-3" />} tone="error">
              连续失败 {task.failStreak}
            </IconTag>
          ) : null}
        </div>

        {expanded ? (
          <div className="border-t border-line/40 px-5 py-3">
            <p className="text-xs uppercase tracking-caps-lg text-muted">Prompt</p>
            <div className="bg-pane-90 mt-1.5 max-h-[180px] overflow-y-auto rounded-card border border-line px-3 py-2.5">
              {" "}
              <pre className="whitespace-pre-wrap font-mono text-sm leading-[1.6] text-ink">
                {task.prompt}
              </pre>
            </div>

            {task.lastError ? (
              <div className="mt-2.5 rounded-card border border-red-200 bg-red-50/80 px-3 py-2.5">
                <p className="text-xs uppercase tracking-caps-lg text-red-600">最近错误</p>
                <p className="mt-1 text-sm leading-[1.5] text-red-700">{task.lastError}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {showRuns ? (
        <TaskRunsModal task={task} account={account} onClose={() => setShowRuns(false)} />
      ) : null}
    </>
  );
}
