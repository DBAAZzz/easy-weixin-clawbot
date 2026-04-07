import { useEffect, useMemo, useState } from "react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  ClockIcon,
  PlayIcon,
  PauseIcon,
  ActivityIcon,
  RefreshIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  HistoryIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  XIcon,
} from "../components/ui/icons.js";
import { useAsyncResource } from "../hooks/use-async-resource.js";
import {
  fetchScheduledTasks,
  fetchScheduledTaskRuns,
  fetchAccounts,
  toggleScheduledTask,
} from "../lib/api.js";
import type { ScheduledTaskDto, ScheduledTaskRunDto } from "../lib/api.js";
import type { AccountSummary } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatCount, formatDateTime, formatDuration } from "../lib/format.js";

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
    if (!hour.includes(",") && !hour.includes("-") && !hour.includes("/") &&
        !minute.includes(",") && !minute.includes("-") && !minute.includes("/")) {
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
    "0": "周日", "7": "周日", "1": "周一", "2": "周二",
    "3": "周三", "4": "周四", "5": "周五", "6": "周六",
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
      const days = dayOfWeek.split(",").map((d) => weekMap[d] ?? d).join("、");
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
  const tone =
    status === "running"
      ? "online"
      : status === "error"
        ? "error"
        : status === "paused"
          ? "offline"
          : "muted";
  const label =
    status === "idle"
      ? "空闲"
      : status === "running"
        ? "运行中"
        : status === "error"
          ? "错误"
          : status === "paused"
            ? "已暂停"
            : status;
  return <Badge tone={tone}>{label}</Badge>;
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
  const { data: runs, loading } = useAsyncResource(
    () => fetchScheduledTaskRuns(task.accountId, task.seq, 20),
    []
  );

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
        className="absolute inset-0 bg-[rgba(15,23,42,0.24)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                Task Runs
              </p>
              <h3 className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]">
                运行记录
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-[var(--muted)]">
                {task.name} · {account?.alias || account?.display_name || task.accountId.slice(0, 12)}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
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
                <div
                  key={i}
                  className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] p-4"
                >
                  <div className="ui-skeleton h-5 w-1/3 rounded-[8px]" />
                  <div className="mt-2 ui-skeleton h-4 w-2/3 rounded-[8px]" />
                </div>
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.48)] px-5 py-10 text-center">
              <HistoryIcon className="mx-auto size-8 text-[var(--muted)]" />
              <p className="mt-3 text-[15px] font-medium text-[var(--ink)]">暂无运行记录</p>
              <p className="mt-2 text-[12px] leading-6 text-[var(--muted)]">
                该任务尚未执行过，或执行记录已被清理。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-[18px] border border-[rgba(21,32,43,0.08)] bg-[rgba(247,250,251,0.84)] px-4 py-4 transition hover:border-[rgba(21,110,99,0.14)] hover:bg-[rgba(255,255,255,0.96)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <RunStatusBadge status={run.status} />
                      <span className="text-[11px] text-[var(--muted)]">
                        {formatDateTime(run.createdAt)}
                      </span>
                    </div>
                    {run.durationMs ? (
                      <span className="text-[11px] text-[var(--muted-strong)]">
                        耗时 {formatDuration(run.durationMs)}
                      </span>
                    ) : null}
                  </div>

                  {run.result ? (
                    <div className="mt-3">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                        执行结果
                      </p>
                      <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-[var(--ink)]">
                        {run.result}
                      </p>
                    </div>
                  ) : null}

                  {run.error ? (
                    <div className="mt-3 rounded-[12px] border border-red-200 bg-red-50 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-red-600">
                        错误信息
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-red-700">{run.error}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-[var(--line)] bg-[rgba(255,255,255,0.92)] px-5 py-4 md:px-6">
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

  const accountLabel =
    account?.alias || account?.display_name || task.accountId.slice(0, 12);

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
          "reveal-up group rounded-[20px] border border-[rgba(21,32,43,0.08)] bg-[rgba(255,255,255,0.88)] transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[rgba(21,110,99,0.14)] hover:bg-[rgba(255,255,255,0.96)]",
          expanded && "border-[rgba(21,110,99,0.14)] bg-[rgba(255,255,255,0.96)]"
        )}
      >
        {/* ── Row 1: icon + name #seq (account)    [type] [status] ── */}
        <div className="flex items-center gap-3 px-5 pt-4">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-[12px] border transition",
              task.enabled
                ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                : "border-[var(--line)] bg-[rgba(148,163,184,0.08)] text-[var(--muted)]"
            )}
          >
            <ClockIcon className="size-4" />
          </span>

          <div className="min-w-0 flex-1">
            <span className="truncate text-[13px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {task.name}
            </span>
            <span className="ml-1.5 text-[11px] text-[var(--muted)]">
              #{task.seq}
            </span>
            <span className="ml-1 text-[11px] text-[var(--muted)]">
              ({accountLabel})
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <Badge tone={task.type === "once" ? "warning" : "muted"}>
              {task.type === "once" ? "单次" : "重复"}
            </Badge>
            <TaskStatusBadge status={task.status} />
          </div>
        </div>

        {/* ── Row 2-3: 2-column info grid ── */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 px-5 pb-3.5 text-[12px]">
          {/* left col */}
          <div className="text-[var(--muted-strong)]">
            <span className="text-[var(--muted)]">下次运行：</span>
            {nextRunText}
          </div>
          {/* right col */}
          <div className="text-[var(--ink)]">
            <span className="text-[var(--muted)]">执行周期：</span>
            {scheduleLabel}
          </div>
          {/* left col */}
          <div className="text-[var(--muted-strong)]">
            <span className="text-[var(--muted)]">上次运行：</span>
            {task.lastRunAt ? formatDateTime(task.lastRunAt) : "—"}
          </div>
          {/* right col */}
          <div className="text-[var(--muted)]">
            <span>运行次数：</span>
            <span className="text-[var(--muted-strong)]">{formatCount(task.runCount)} 次</span>
            {task.failStreak > 0 ? (
              <span className="ml-1.5 text-red-500">连续失败 {task.failStreak}</span>
            ) : null}
          </div>
        </div>

        {/* ── Expanded: prompt + error ── */}
        {expanded ? (
          <div className="border-t border-[var(--line)]/40 px-5 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Prompt</p>
            <div className="mt-1.5 max-h-[180px] overflow-y-auto rounded-[10px] border border-[var(--line)] bg-[rgba(247,250,251,0.9)] px-3 py-2.5">
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-[1.6] text-[var(--ink)]">
                {task.prompt}
              </pre>
            </div>

            {task.lastError ? (
              <div className="mt-2.5 rounded-[10px] border border-red-200 bg-red-50/80 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-red-600">最近错误</p>
                <p className="mt-1 text-[11px] leading-[1.5] text-red-700">{task.lastError}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Action bar ── */}
        <div className="flex items-center border-t border-[var(--line)]/40 px-4 py-1.5">
          <button
            type="button"
            onClick={() => setShowRuns(true)}
            className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-strong)] transition hover:bg-[rgba(21,110,99,0.06)] hover:text-[var(--accent-strong)]"
          >
            <HistoryIcon className="size-3.5" />
            记录
          </button>
          <button
            type="button"
            disabled={toggling}
            onClick={async () => {
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
            className={cn(
              "inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium transition disabled:opacity-50",
              task.enabled
                ? "text-red-500 hover:bg-red-50 hover:text-red-600"
                : "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
            )}
          >
            {task.enabled ? (
              <>
                <PauseIcon className="size-3.5" />
                暂停
              </>
            ) : (
              <>
                <PlayIcon className="size-3.5" />
                启用
              </>
            )}
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-[11px] text-[var(--muted)] transition hover:bg-[rgba(21,110,99,0.06)] hover:text-[var(--accent-strong)]"
          >
            {expanded ? "收起" : "详情"}
            {expanded ? (
              <ChevronUpIcon className="size-3.5" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
          </button>
        </div>
      </div>

      {showRuns ? (
        <TaskRunsModal task={task} account={account} onClose={() => setShowRuns(false)} />
      ) : null}
    </>
  );
}

export function ScheduledTasksPage() {
  const [revision, setRevision] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const { data: tasksData, loading, error } = useAsyncResource(
    () => fetchScheduledTasks(),
    [revision]
  );
  const { data: accountsData } = useAsyncResource(() => fetchAccounts(), []);

  const tasks = tasksData ?? [];
  const accounts = accountsData ?? [];

  // Debug logging
  useEffect(() => {
    console.log("[ScheduledTasks] tasksData:", tasksData);
    console.log("[ScheduledTasks] tasks:", tasks);
    console.log("[ScheduledTasks] loading:", loading);
    console.log("[ScheduledTasks] error:", error);
  }, [tasksData, tasks, loading, error]);

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const query = searchQuery.toLowerCase();
    return tasks.filter(
      (task) =>
        task.name.toLowerCase().includes(query) ||
        task.accountId.toLowerCase().includes(query) ||
        task.cron.toLowerCase().includes(query)
    );
  }, [tasks, searchQuery]);

  const refresh = () => setRevision((r) => r + 1);

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
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              Scheduled Tasks
            </p>
            <h2 className="mt-1.5 text-[24px] text-[var(--ink)]">定时任务</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[var(--muted)]">
              管理基于 Cron 表达式的定时任务，支持为不同账号和会话配置自动化消息推送。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
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
        <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载定时任务失败：{error}
        </div>
      ) : null}

      {loading ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[rgba(255,255,255,0.8)] px-4 py-4 md:px-5"
            >
              <div className="flex items-center gap-3">
                <div className="ui-skeleton size-10 rounded-[14px]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="ui-skeleton h-5 rounded-[8px]" />
                  <div className="ui-skeleton h-4 rounded-[8px]" />
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
        <section className="rounded-[28px] border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.48)] px-5 py-10 text-center">
          <ClockIcon className="mx-auto size-8 text-[var(--muted)]" />
          <p className="mt-3 text-[15px] font-medium text-[var(--ink)]">暂无定时任务</p>
          <p className="mt-2 text-[12px] leading-6 text-[var(--muted)]">
            使用 #schedule 命令在对话中创建定时任务。
          </p>
        </section>
      ) : null}

      {!loading && filteredTasks.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <ClockIcon className="size-4 text-[var(--muted-strong)]" />
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
                    id === `${task.accountId}-${task.seq}`
                      ? null
                      : `${task.accountId}-${task.seq}`
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
