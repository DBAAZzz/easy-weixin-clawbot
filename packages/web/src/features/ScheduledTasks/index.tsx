import { ClockIcon, Input } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import { StatsGrid } from "../Dashboard/StatsGrid.js";
import { ScheduledTaskCard } from "./ScheduledTaskCard.js";
import { useScheduledTasks } from "./useScheduledTasks.js";

export function ScheduledTasksPage() {
  const {
    accounts,
    error,
    expandedTaskId,
    filteredTasks,
    loading,
    refresh,
    searchQuery,
    setExpandedTaskId,
    setSearchQuery,
    stats,
  } = useScheduledTasks();

  const scheduledTaskStats = [
    {
      label: "定时任务",
      value: formatCount(stats.total),
      meta: "全部任务",
      dotClassName: "bg-account-ink",
      valueClassName: "text-account-ink",
    },
    {
      label: "已启用",
      value: formatCount(stats.enabled),
      meta: "可调度",
      dotClassName: "bg-account-success-dot",
      valueClassName: "text-account-success-fg",
    },
    {
      label: "运行中",
      value: formatCount(stats.running),
      meta: "执行中",
      dotClassName: "bg-account-warning-dot",
      valueClassName: "text-account-warning-fg",
    },
    {
      label: "错误",
      value: formatCount(stats.error),
      meta: "需处理",
      dotClassName: "bg-danger",
      valueClassName: "text-danger-strong",
    },
    {
      label: "暂停",
      value: formatCount(stats.paused),
      meta: "已停用",
      dotClassName: "bg-account-muted-faint",
      valueClassName: "text-account-muted",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
      <DashboardHeader
        eyebrow="Scheduled Tasks"
        title="定时任务"
        description="查看 prompt 定时任务的调度和运行状态"
        refreshLabel="刷新"
        onRefresh={refresh}
      />

      <StatsGrid stats={scheduledTaskStats} />

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            type="text"
            placeholder="搜索任务名称、账号或 Cron..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full md:w-account-search"
          />
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
