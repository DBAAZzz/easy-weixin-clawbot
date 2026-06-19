export const FLAG_OPTIONS = [
  { value: "", label: "全部标记" },
  { value: "error", label: "error" },
  { value: "max_rounds", label: "max_rounds" },
  { value: "slow", label: "slow" },
  { value: "expensive", label: "expensive" },
];

export const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "ok", label: "成功" },
  { value: "error", label: "异常" },
];

export const WINDOW_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

export type ObservabilityAccent = "ink" | "accent" | "danger" | "success" | "warning" | "muted";

export const accentClassNames: Record<
  ObservabilityAccent,
  { dot: string; value: string; bar: string }
> = {
  ink: {
    dot: "bg-account-ink",
    value: "text-account-ink",
    bar: "bg-account-ink",
  },
  accent: {
    dot: "bg-accent",
    value: "text-account-ink",
    bar: "bg-accent",
  },
  danger: {
    dot: "bg-state-error",
    value: "text-danger",
    bar: "bg-state-error",
  },
  success: {
    dot: "bg-account-success-dot",
    value: "text-account-success-fg",
    bar: "bg-account-success-dot",
  },
  warning: {
    dot: "bg-state-warning",
    value: "text-account-ink",
    bar: "bg-state-warning",
  },
  muted: {
    dot: "bg-account-muted-faint",
    value: "text-account-muted",
    bar: "bg-account-muted-faint",
  },
};
