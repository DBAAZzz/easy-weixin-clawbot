import { Breadcrumb } from "@clawbot/ui";
import { useNavigate } from "react-router-dom";

export function TracePageHeader({ traceId }: { traceId?: string }) {
  const navigate = useNavigate();

  function goBackToObservability() {
    if (typeof window !== "undefined" && (window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
    } else {
      navigate("/observability");
    }
  }

  return (
    <Breadcrumb
      backHref="/observability"
      className="text-base"
      items={[
        { label: "可观测性中心", href: "/observability" },
        {
          label: (
            <span className="font-mono text-account-ink">{traceId ?? "missing-trace-id"}</span>
          ),
          current: true,
        },
      ]}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) {
          event.preventDefault();
          goBackToObservability();
        }
      }}
    />
  );
}
