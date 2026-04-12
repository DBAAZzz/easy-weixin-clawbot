const NODE_LEGEND = [
  { label: "Fact", description: "事实记忆", color: "#3B82F6" },
  { label: "Preference", description: "偏好记忆", color: "#10B981" },
  { label: "Decision", description: "决策记录", color: "#F59E0B" },
];

const EDGE_LEGEND = [
  { label: "共现边", description: "同一批提取的记忆会连成实线", line: "solid" as const },
  { label: "前缀边", description: "层级 key 共享前缀时用虚线聚类", line: "dashed" as const },
];

export function MemoryLegend(props: { variant?: "inline" | "floating" }) {
  const floating = props.variant === "floating";

  return (
    <div
      className={[
        "flex flex-wrap items-center gap-2 rounded-[18px] border px-3 py-2.5 text-[11px] shadow-[0_24px_48px_-36px_rgba(15,23,42,0.35)] backdrop-blur-xl",
        floating
          ? "absolute bottom-4 right-4 z-10 max-w-[calc(100%-2rem)] border-white/70 bg-[rgba(255,255,255,0.82)]"
          : "border-[var(--line)] bg-white/72",
      ].join(" ")}
    >
      <div className="flex flex-wrap gap-2">
        {NODE_LEGEND.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.14)] bg-white/82 px-2.5 py-1 text-[11px] text-[var(--muted-strong)]"
          >
            <span
              className="size-2.5 rounded-full shadow-[0_0_0_3px_rgba(255,255,255,0.85)]"
              style={{ backgroundColor: item.color }}
            />
            <span>{item.description}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-[var(--muted)]">
        {EDGE_LEGEND.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-2 rounded-full border border-[rgba(148,163,184,0.14)] bg-white/68 px-2.5 py-1"
          >
            <span
              className="w-8 border-t border-[var(--muted-strong)]"
              style={{ borderStyle: item.line }}
            />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
