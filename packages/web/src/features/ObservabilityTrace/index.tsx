import { useParams } from "react-router-dom";
import { useObservabilityTrace } from "../../hooks/useObservability.js";
import { TraceDetailSection } from "./TraceDetailSection.js";
import { TraceErrorNotice } from "./TraceErrorNotice.js";
import { TracePageHeader } from "./TracePageHeader.js";

export function ObservabilityTracePage() {
  const params = useParams<{ traceId: string }>();
  const traceId = params.traceId;
  const trace = useObservabilityTrace(traceId);

  return (
    <div className="space-y-5 md:space-y-6">
      <TracePageHeader traceId={traceId} />
      <TraceErrorNotice error={trace.error} />
      <TraceDetailSection trace={trace.trace} loading={trace.loading} />
    </div>
  );
}
