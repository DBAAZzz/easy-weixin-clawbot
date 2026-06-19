import type { ObservabilityTraceDetail } from "@clawbot/shared";
import { TraceDetailPanel } from "../../components/observability/TraceDetailPanel.js";

export function TraceDetailSection({
  loading,
  trace,
}: {
  loading: boolean;
  trace: ObservabilityTraceDetail | null;
}) {
  return (
    <section>
      <TraceDetailPanel trace={trace} loading={loading} />
    </section>
  );
}
