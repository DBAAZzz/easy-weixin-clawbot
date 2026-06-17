import { useQuery } from "@tanstack/react-query";
import { Badge } from "@clawbot/ui";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@clawbot/ui";
import { ClockIcon } from "@clawbot/ui";
import { fetchScheduledTaskRuns } from "@/api/scheduled-tasks.js";
import { queryKeys } from "../../lib/query-keys.js";
import { formatDateTime, formatDuration } from "../../lib/format.js";

export function RunsDialog(props: {
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
