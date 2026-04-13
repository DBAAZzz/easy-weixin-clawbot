import { Link, useParams } from "react-router-dom";
import { useObservabilityTrace } from "../hooks/useObservability.js";
import { Card } from "../components/ui/card.js";
import { Button, buttonClassName } from "../components/ui/button.js";
import { ArrowRightIcon, RefreshIcon } from "../components/ui/icons.js";
import { TraceDetailPanel } from "../components/observability/TraceDetailPanel.js";

export function ObservabilityTracePage() {
  const params = useParams<{ traceId: string }>();
  const traceId = params.traceId;
  const trace = useObservabilityTrace(traceId);

  return (
    <div className="space-y-4 md:space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Trace Detail</p>
            <h2 className="mt-1.5 text-4xl text-ink">链路详情</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              to="/observability"
              className={buttonClassName({ variant: "outline", size: "sm" })}
            >
              <ArrowRightIcon className="size-4 rotate-180" />
              返回 Trace 列表
            </Link>
            <Button size="sm" onClick={trace.refresh} disabled={!traceId}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
          </div>
        </div>

        <Card className="space-y-2">
          <p className="text-xs uppercase tracking-caps-lg text-muted">Trace ID</p>
          <p className="break-all font-mono text-md text-ink">{traceId ?? "missing-trace-id"}</p>
        </Card>

        {trace.error ? (
          <div className="rounded-lg border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载链路详情失败：{trace.error}
          </div>
        ) : null}
      </section>

      <section>
        <TraceDetailPanel trace={trace.trace} loading={trace.loading} />
      </section>
    </div>
  );
}
