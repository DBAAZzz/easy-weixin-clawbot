export function StatCard(props: {
  label: string;
  value: string;
  hint: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-glass-76 flex h-full items-center gap-3 rounded-lg border border-slate-border px-3.5 py-3">
      {" "}
      {props.icon ? (
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-panel"
          style={{
            backgroundColor: props.color ? `${props.color}14` : "rgba(148,163,184,0.08)",
            color: props.color,
          }}
        >
          {props.icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs uppercase tracking-label text-muted">{props.label}</p>
          <p className="font-mono text-3xl font-semibold text-ink">{props.value}</p>
        </div>
        <p className="mt-1 text-sm leading-5 text-muted">{props.hint}</p>
      </div>
    </div>
  );
}
