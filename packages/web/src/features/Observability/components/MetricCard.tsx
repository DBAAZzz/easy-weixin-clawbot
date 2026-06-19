import { Card } from "@clawbot/ui";
import { cn } from "../../../lib/cn.js";
import { accentClassNames, type ObservabilityAccent } from "./constants.js";

export function MetricCard(props: {
  label: string;
  value: string;
  meta?: string;
  accent?: ObservabilityAccent;
}) {
  const accent = accentClassNames[props.accent ?? "ink"];

  return (
    <Card className="rounded-section border-account-line bg-account-card shadow-account-control backdrop-blur-none">
      <div className="mb-3.5 flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", accent.dot)} />
        <span className="text-sm font-medium text-account-muted">{props.label}</span>
      </div>
      <div className={cn("font-sans text-2xl font-bold leading-none tracking-title", accent.value)}>
        {props.value}
      </div>
      {props.meta ? (
        <div className="mt-2 text-sm leading-4 text-account-muted-faint">{props.meta}</div>
      ) : null}
    </Card>
  );
}
