import { useEffect } from "react";
import { Badge, Button, XIcon, HistoryIcon } from "@clawbot/ui";
import { useQuery } from "@tanstack/react-query";
import { fetchScheduledTaskRuns } from "@/api/scheduled-tasks.js";
import type { ScheduledTaskDto } from "@/api/scheduled-tasks.js";
import type { AccountSummary } from "@clawbot/shared";
import { queryKeys } from "../../lib/query-keys.js";
import { formatCount, formatDateTime, formatDuration } from "../../lib/format.js";
import { RunStatusBadge, TaskStatusBadge } from "./types.js";

export function TaskRunsModal({
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
          <Button size="sm" type="button" variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  );
}
