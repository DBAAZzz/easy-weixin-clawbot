import { Card } from "@clawbot/ui";
import { cn } from "../../../lib/cn.js";
import { accentClassNames, type ObservabilityAccent } from "./constants.js";

export function LatencyPanel({
  items,
}: {
  items: Array<{
    label: string;
    value: string;
    ratio: number;
    accent: ObservabilityAccent;
  }>;
}) {
  return (
    <Card className="rounded-section border-account-line bg-account-card shadow-account-control backdrop-blur-none">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-account-ink">耗时分位</h2>
        <span className="text-sm text-account-muted">端到端响应延迟</span>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {items.map((item, index) => {
          const accent = accentClassNames[item.accent];

          return (
            <div key={item.label}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <span
                  className={cn("font-mono text-base font-semibold tracking-mono", accent.value)}
                >
                  {item.label}
                </span>
                <span className="font-mono text-xl font-bold leading-none tracking-title text-account-ink">
                  {item.value}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-pill bg-account-filter-track">
                <div
                  className={cn("observability-progress-fill h-full rounded-pill", accent.bar)}
                  style={{
                    width: `${Math.max(4, Math.min(100, item.ratio))}%`,
                    animationDelay: `${index * 80}ms`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
