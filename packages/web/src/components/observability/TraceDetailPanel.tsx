import type { ObservabilityTraceDetail } from "@clawbot/shared";
import { formatCount, formatMs } from "../../lib/format.js";
import { cn } from "../../lib/cn.js";
import { getTraceStatus } from "../../lib/observability.js";
import { Card } from "../ui/card.js";
import { WaterfallTimeline } from "./WaterfallTimeline.js";
import { TraceFlagList } from "./TraceFlagList.js";

export function TraceDetailPanel(props: {
  trace: ObservabilityTraceDetail | null;
  loading: boolean;
}) {
  const traceStatus = props.trace ? getTraceStatus(props.trace) : null;

  return (
    <Card className="space-y-4">
      {props.loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="ui-skeleton h-10 rounded-lg" />
          ))}
        </div>
      ) : props.trace ? (
        <div className="space-y-4">
          <div className="bg-pane-70 flex flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3">
            {" "}
            <p className="font-mono text-base text-ink">{props.trace.trace_id}</p>
            {traceStatus ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-tag",
                  traceStatus.className,
                )}
              >
                {traceStatus.label}
              </span>
            ) : null}
            <span className="text-sm text-muted">
              {props.trace.account_id} · {props.trace.conversation_id}
            </span>
            <span className="text-sm text-muted">
              {formatMs(props.trace.total_ms)} · {formatCount(props.trace.llm_rounds)} rounds ·{" "}
              {formatCount(props.trace.tool_calls)} tools
            </span>
            <TraceFlagList flags={props.trace.flags} />
          </div>

          <WaterfallTimeline trace={props.trace} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-white/52 px-4 py-8 text-base leading-6 text-muted">
          这条 trace 可能已被清理，或者当前账号没有权限访问。
        </div>
      )}
    </Card>
  );
}
