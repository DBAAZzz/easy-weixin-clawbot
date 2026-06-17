import { Card } from "@clawbot/ui";

export const FLAG_OPTIONS = [
  { value: "", label: "全部标记" },
  { value: "error", label: "error" },
  { value: "max_rounds", label: "max_rounds" },
  { value: "slow", label: "slow" },
  { value: "expensive", label: "expensive" },
];

export const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "ok", label: "正常" },
  { value: "error", label: "异常" },
];

export function MetricCard(props: {
  label: string;
  value: string;
  hint?: string;
  tooltip?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <p className="text-xs uppercase tracking-caps-lg text-muted">{props.label}</p>
        {props.tooltip && (
          <span className="group relative">
            <svg
              className="size-3 cursor-help text-muted transition hover:text-ink"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            >
              <circle cx="8" cy="8" r="6.5" />
              <path d="M6.2 6.5a1.8 1.8 0 0 1 3.5.5c0 1.2-1.7 1.2-1.7 2.2" strokeLinecap="round" />
              <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
            </svg>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-sm leading-[1.6] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {props.tooltip}
            </span>
          </span>
        )}
      </div>
      <p className="font-mono text-3xl font-semibold text-ink">{props.value}</p>
      {props.hint && <p className="text-sm text-muted">{props.hint}</p>}
    </div>
  );
}

export function ChartList(props: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: string; ratio: number; meta?: string }>;
  empty: string;
}) {
  return (
    <Card className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-label-lg text-muted">{props.title}</p>
        <h3 className="mt-1.5 text-2xl text-ink">{props.subtitle}</h3>
      </div>

      {props.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white/52 px-4 py-5 text-base text-muted">
          {props.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {props.rows.map((row) => (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-base">
                <div className="min-w-0">
                  <p className="truncate text-ink">{row.label}</p>
                  {row.meta ? <p className="text-sm text-muted">{row.meta}</p> : null}
                </div>
                <span className="shrink-0 font-mono text-sm text-muted-strong">{row.value}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-wash">
                <div
                  className="bg-metric-gradient h-full rounded-full"
                  style={{ width: `${Math.max(6, Math.round(row.ratio * 100))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
