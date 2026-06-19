import { cn } from "../../lib/cn.js";

export function MetricCard(props: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line bg-glass-82 px-4 py-4">
      <p className="text-xs uppercase tracking-label-lg text-muted">{props.label}</p>
      <p className="mt-2 text-6xl font-semibold tracking-heading text-ink">{props.value}</p>
      <p className="mt-1 text-base leading-5 text-muted">{props.hint}</p>
    </div>
  );
}

export function statusClassName(status: string) {
  return cn(
    "rounded-full px-2 py-0.5 text-sm font-medium",
    status === "success"
      ? "bg-emerald-50 text-emerald-700"
      : status === "rejected"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700",
  );
}
