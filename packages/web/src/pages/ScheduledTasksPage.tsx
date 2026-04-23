import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { CardOverflowMenu, CardToggle, IconTag, MetricGrid } from "../components/ui/admin-card.js";
import {
  ClockIcon,
  ActivityIcon,
  RefreshIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  HistoryIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  LayersIcon,
  StackIcon,
  XIcon,
} from "../components/ui/icons.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchScheduledTasks,
  fetchScheduledTaskRuns,
  toggleScheduledTask,
} from "@/api/scheduled-tasks.js";
import { queryKeys } from "../lib/query-keys.js";
import { useAccounts } from "../hooks/useAccounts.js";
import type { ScheduledTaskDto, ScheduledTaskRunDto } from "@/api/scheduled-tasks.js";
import type { AccountSummary } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatCount, formatDateTime, formatDuration } from "../lib/format.js";

const PROMPT_TASK_KIND = "prompt" as const;

/**
 * Translate a 5-part cron expression into readable Chinese.
 * e.g. "0 9 * * *" → "每天 09:00", "30 8 * * 1-5" → "工作日 08:30"
 */
function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const pad = (v: string) => v.padStart(2, "0");

  // Resolve time string
  let timeStr = "";
  if (hour !== "*" && minute !== "*") {
    // e.g. hour="9", minute="0" → "09:00"
    if (
      !hour.includes(",") &&
      !hour.includes("-") &&
      !hour.includes("/") &&
      !minute.includes(",") &&
      !minute.includes("-") &&
      !minute.includes("/")
    ) {
      timeStr = `${pad(hour)}:${pad(minute)}`;
    }
  }
  if (hour !== "*" && minute === "*") {
    timeStr = `${pad(hour)}:xx`;
  }

  // Step-based intervals
  if (hour === "*" && minute.startsWith("*/")) {
    const n = minute.slice(2);
    return `每 ${n} 分钟`;
  }
  if (minute === "0" && hour.startsWith("*/")) {
    const n = hour.slice(2);
    return `每 ${n} 小时`;
  }

  // Day-of-week mapping
  const weekMap: Record<string, string> = {
    "0": "周日",
    "7": "周日",
    "1": "周一",
    "2": "周二",
    "3": "周三",
    "4": "周四",
    "5": "周五",
    "6": "周六",
  };

  // Specific day of month
  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    if (!dayOfMonth.includes(",") && !dayOfMonth.includes("-") && !dayOfMonth.includes("/")) {
      return `每月${dayOfMonth}日 ${timeStr}`.trim();
    }
  }

  // Day-of-week patterns
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    if (dayOfWeek === "1-5") return `工作日 ${timeStr}`.trim();
    if (dayOfWeek === "0,6" || dayOfWeek === "6,0") return `周末 ${timeStr}`.trim();
    // single day
    if (weekMap[dayOfWeek]) return `每${weekMap[dayOfWeek]} ${timeStr}`.trim();
    // comma-separated days
    if (dayOfWeek.includes(",")) {
      const days = dayOfWeek
        .split(",")
        .map((d) => weekMap[d] ?? d)
        .join("、");
      return `每${days} ${timeStr}`.trim();
    }
  }

  // Default: every day at time
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && timeStr) {
    return `每天 ${timeStr}`;
  }

  return cron;
}

function TaskStatusBadge({ status }: { status: ScheduledTaskDto["status"] }) {
  const tone = getTaskStatusTone(status);
  const label = getTaskStatusLabel(status);
  return <Badge tone={tone}>{label}</Badge>;
}

function getTaskStatusTone(
  status: ScheduledTaskDto["status"],
): "online" | "offline" | "muted" | "error" | "warning" {
  return status === "running"
    ? "online"
    : status === "error"
      ? "error"
      : status === "paused"
        ? "offline"
        : "muted";
}

function getTaskStatusLabel(status: ScheduledTaskDto["status"]): string {
  return status === "idle"
    ? "空闲"
    : status === "running"
      ? "运行中"
      : status === "error"
        ? "错误"
        : status === "paused"
          ? "已暂停"
          : status;
}

function getTaskStatusIcon(status: ScheduledTaskDto["status"]) {
  return status === "running" ? (
    <ActivityIcon className="size-3" />
  ) : status === "error" ? (
    <AlertCircleIcon className="size-3" />
  ) : status === "paused" ? (
    <ClockIcon className="size-3" />
  ) : (
    <CheckCircleIcon className="size-3" />
  );
}

function RunStatusBadge({ status }: { status: ScheduledTaskRunDto["status"] }) {
  const icon =
    status === "success" ? (
      <CheckCircleIcon className="size-3" />
    ) : status === "error" ? (
      <AlertCircleIcon className="size-3" />
    ) : status === "timeout" ? (
      <ClockIcon className="size-3" />
    ) : (
      <ActivityIcon className="size-3" />
    );
  const tone =
    status === "success"
      ? "online"
      : status === "error"
        ? "error"
        : status === "timeout"
          ? "warning"
          : "muted";
  return (
    <Badge tone={tone} className="gap-1">
      {icon}
      {status === "success"
        ? "成功"
        : status === "error"
          ? "失败"
          : status === "timeout"
            ? "超时"
            : status === "skipped"
              ? "跳过"
              : status}
    </Badge>
  );
}

function TaskRunsModal({
  task,
  account,
  onClose,
}: {
  task: ScheduledTaskDto;
  account: AccountSummary | undefined;
  onClose: () => void;
}) {
  const { data: runs, isPending: loading } = useQuery({
    queryKey: queryKeys.scheduledTaskRuns(task.accountId, task.seq),
    queryFn: () => fetchScheduledTaskRuns(task.accountId, task.seq, 20),
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭运行记录弹窗"
        onClick={onClose}
        className="absolute inset-0 bg-overlay backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-pill border border-modal-border bg-card-hover shadow-modal"
      >
        <div className="border-b border-line px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">Task Runs</p>
              <h3 className="mt-1.5 text-5xl font-semibold tracking-heading text-ink">运行记录</h3>
              <p className="mt-2 text-md leading-6 text-muted">
                {task.name} ·{" "}
                {account?.alias || account?.display_name || task.accountId.slice(0, 12)}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white/80 text-muted-strong transition hover:border-line-strong hover:text-ink"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={task.type === "once" ? "warning" : "online"}>
              {task.type === "once" ? "单次" : "重复"}
            </Badge>
            <TaskStatusBadge status={task.status} />
            <Badge tone="muted">Cron: {task.cron}</Badge>
            <Badge tone="muted">运行 {formatCount(task.runCount)} 次</Badge>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-section border border-line bg-detail-bg p-4">
                  <div className="ui-skeleton h-5 w-1/3 rounded-lg" />
                  <div className="mt-2 ui-skeleton h-4 w-2/3 rounded-lg" />
                </div>
              ))}
            </div>
          ) : !runs || runs.length === 0 ? (
            <div className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
              <HistoryIcon className="mx-auto size-8 text-muted" />
              <p className="mt-3 text-xl font-medium text-ink">暂无运行记录</p>
              <p className="mt-2 text-base leading-6 text-muted">
                该任务尚未执行过，或执行记录已被清理。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {runs!.map((run) => (
                <div
                  key={run.id}
                  className="rounded-section border border-card-line bg-detail-bg px-4 py-4 transition hover:border-notice-success-border hover:bg-card-hover"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <span className="text-sm text-muted">{formatDateTime(run.createdAt)}</span>
                    </div>
                    {run.durationMs ? (
                      <span className="text-sm text-muted-strong">
                        耗时 {formatDuration(run.durationMs)}
                      </span>
                    ) : null}
                  </div>

                  {run.result ? (
                    <div className="mt-3">
                      <p className="text-xs uppercase tracking-label text-muted">执行结果</p>
                      <p className="mt-1 line-clamp-3 text-base leading-5 text-ink">{run.result}</p>
                    </div>
                  ) : null}

                  {run.error ? (
                    <div className="mt-3 rounded-panel border border-red-200 bg-red-50 px-3 py-2">
                      <p className="text-xs uppercase tracking-label text-red-600">错误信息</p>
                      <p className="mt-1 text-base leading-5 text-red-700">{run.error}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-glass-92 px-5 py-4 md:px-6">
          <Button type="button" variant="outline" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}

function ScheduledTaskCard({
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

export function ScheduledTasksPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const {
    data: tasksData,
    isPending: loading,
    error: tasksRawError,
  } = useQuery({
    queryKey: queryKeys.scheduledTasks(undefined, PROMPT_TASK_KIND),
    queryFn: () => fetchScheduledTasks(undefined, PROMPT_TASK_KIND),
    staleTime: 15_000,
  });
  const { accounts } = useAccounts();

  const tasks = tasksData ?? [];
  const error =
    tasksRawError instanceof Error
      ? tasksRawError.message
      : tasksRawError
        ? String(tasksRawError)
        : null;

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const query = searchQuery.toLowerCase();
    return tasks.filter(
      (task) =>
        task.name.toLowerCase().includes(query) ||
        task.accountId.toLowerCase().includes(query) ||
        task.cron.toLowerCase().includes(query),
    );
  }, [tasks, searchQuery]);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.scheduledTasks(undefined, PROMPT_TASK_KIND),
    });
  };

  const stats = useMemo(() => {
    const enabled = tasks.filter((t) => t.enabled).length;
    const running = tasks.filter((t) => t.status === "running").length;
    const error = tasks.filter((t) => t.status === "error").length;
    const paused = tasks.filter((t) => t.status === "paused").length;
    return { total: tasks.length, enabled, running, error, paused };
  }, [tasks]);

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Scheduled Tasks</p>
            <h2 className="mt-1.5 text-6xl text-ink">定时任务</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <Badge tone="muted">总数 {formatCount(stats.total)}</Badge>
            <Badge tone="online">启用 {formatCount(stats.enabled)}</Badge>
            <Badge tone="warning">运行中 {formatCount(stats.running)}</Badge>
            <Badge tone="error">错误 {formatCount(stats.error)}</Badge>
            <Badge tone="offline">暂停 {formatCount(stats.paused)}</Badge>
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="搜索任务名称、账号或 Cron..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-[260px]"
            />
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载定时任务失败：{error}
        </div>
      ) : null}

      {loading ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-lg border border-line bg-glass-80 px-4 py-4 md:px-5"
            >
              <div className="flex items-center gap-3">
                <div className="ui-skeleton size-10 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="ui-skeleton h-5 rounded-lg" />
                  <div className="ui-skeleton h-4 rounded-lg" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="ui-skeleton h-3 w-1/3 rounded-full" />
                <div className="ui-skeleton h-3 w-2/3 rounded-full" />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!loading && filteredTasks.length === 0 ? (
        <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
          <ClockIcon className="mx-auto size-8 text-muted" />
          <p className="mt-3 text-xl font-medium text-ink">暂无定时任务</p>
        </section>
      ) : null}

      {!loading && filteredTasks.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted">
            <ClockIcon className="size-4 text-muted-strong" />
            <span>
              当前展示 {formatCount(filteredTasks.length)} 个定时任务
              {searchQuery && " (搜索结果)"}
            </span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {filteredTasks.map((task) => (
              <ScheduledTaskCard
                key={`${task.accountId}-${task.seq}`}
                task={task}
                account={accounts.find((a) => a.id === task.accountId)}
                expanded={expandedTaskId === `${task.accountId}-${task.seq}`}
                onToggleExpand={() =>
                  setExpandedTaskId((id) =>
                    id === `${task.accountId}-${task.seq}` ? null : `${task.accountId}-${task.seq}`,
                  )
                }
                onRefresh={refresh}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
