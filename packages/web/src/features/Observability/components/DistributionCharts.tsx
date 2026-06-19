import { Card } from "@clawbot/ui";
import type { ReactNode } from "react";
import { cn } from "../../../lib/cn.js";
import { accentClassNames, type ObservabilityAccent } from "./constants.js";

export function RoundDistributionChart({
  rows,
  empty,
}: {
  rows: Array<{ label: string; value: string; ratio: number }>;
  empty: string;
}) {
  return (
    <ChartCard title="LLM 轮数分布" subtitle="单次会话内模型调用轮数">
      {rows.length === 0 ? (
        <ChartEmpty>{empty}</ChartEmpty>
      ) : (
        <div className="flex h-observability-chart items-end justify-between gap-2">
          {rows.map((row, index) => (
            <div
              key={row.label}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
            >
              <span className="font-mono text-sm font-semibold text-account-muted">
                {row.value}
              </span>
              <div
                className={cn(
                  "observability-bar-fill w-full max-w-observability-bar rounded-t-card rounded-b-xs",
                  row.ratio >= 0.98 ? "bg-accent" : "bg-accent-mist",
                )}
                style={{
                  height: `${Math.max(6, Math.round(row.ratio * 100))}%`,
                  animationDelay: `${index * 60}ms`,
                }}
              />
              <span className="font-mono text-sm text-account-muted-faint">{row.label}</span>
            </div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

export function BarDistributionChart({
  title,
  subtitle,
  rows,
  empty,
  showDot,
}: {
  title: string;
  subtitle: string;
  rows: Array<{
    label: string;
    value: string;
    ratio: number;
    meta?: string;
    accent?: ObservabilityAccent;
  }>;
  empty: string;
  showDot?: boolean;
}) {
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <ChartEmpty>{empty}</ChartEmpty>
      ) : (
        <div className="space-y-3.5">
          {rows.map((row, index) => {
            const accent = accentClassNames[row.accent ?? "accent"];

            return (
              <div key={row.label}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {showDot ? <span className={cn("size-2 rounded-xs", accent.dot)} /> : null}
                      <span className="truncate font-mono text-base font-medium text-account-ink">
                        {row.label}
                      </span>
                    </div>
                    {row.meta ? (
                      <p className="mt-1 truncate text-sm text-account-muted">{row.meta}</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 font-mono text-sm font-semibold text-account-muted">
                    {row.value}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-pill bg-account-filter-track">
                  <div
                    className={cn("observability-progress-fill h-full rounded-pill", accent.bar)}
                    style={{
                      width: `${Math.max(4, Math.round(row.ratio * 100))}%`,
                      animationDelay: `${index * 55}ms`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ChartCard>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-section border-account-line bg-account-card shadow-account-control backdrop-blur-none">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-account-ink">{title}</h2>
        <p className="mt-1 text-sm text-account-muted">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-account-line bg-account-table-head px-4 py-5 text-base text-account-muted">
      {children}
    </div>
  );
}
