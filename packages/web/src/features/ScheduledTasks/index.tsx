import { Badge, Button, ClockIcon, Input, RefreshIcon } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
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

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Scheduled Tasks</p>
            <h2 className="mt-1.5 text-6xl text-ink">定时任务</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={refresh}>
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
