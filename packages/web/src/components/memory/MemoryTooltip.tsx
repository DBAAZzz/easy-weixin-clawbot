import type { ReactNode } from "react";
import type { TapeGraphNode } from "@clawbot/shared";
import { formatDateTime } from "../../lib/format.js";
import { Card } from "../ui/card.js";
import { BookIcon, DiamondIcon, HeartIcon, SearchIcon } from "../ui/icons.js";

export function formatMemoryValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "无法预览该值";
  }
}

const CATEGORY_LABELS: Record<TapeGraphNode["category"], string> = {
  fact: "事实记忆",
  preference: "偏好记忆",
  decision: "决策记录",
};

const CATEGORY_COLORS: Record<TapeGraphNode["category"], string> = {
  fact: "#3B82F6",
  preference: "#10B981",
  decision: "#F59E0B",
};

const CATEGORY_ICON_COMPONENTS: Record<TapeGraphNode["category"], (className: string) => ReactNode> = {
  fact: (cls) => <BookIcon className={cls} />,
  preference: (cls) => <HeartIcon className={cls} />,
  decision: (cls) => <DiamondIcon className={cls} />,
};

function formatSourceEid(sourceEid: string) {
  if (sourceEid.length <= 10) return sourceEid;
  return `${sourceEid.slice(0, 4)}…${sourceEid.slice(-4)}`;
}

function ConfidenceBar(props: { value: number }) {
  const percent = Math.round(props.value * 100);
  const barColor =
    props.value >= 0.8 ? "#10B981" : props.value >= 0.5 ? "#F59E0B" : "#EF4444";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Confidence</p>
        <span className="font-[var(--font-mono)] text-[13px] font-semibold" style={{ color: barColor }}>
          {percent}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[rgba(148,163,184,0.12)]">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percent}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

function MetaCard(props: { label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <div className="rounded-lg border border-[rgba(148,163,184,0.14)] bg-[rgba(248,250,252,0.74)] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">{props.label}</p>
      <p
        title={props.title}
        className={[
          "mt-1 truncate text-[12px] leading-5 text-[var(--ink)]",
          props.mono ? "font-[var(--font-mono)]" : "",
        ].join(" ")}
      >
        {props.value}
      </p>
    </div>
  );
}

export function MemoryTooltip(props: {
  node: TapeGraphNode | null;
  highlightedCount: number;
}) {
  if (!props.node) {
    return (
      <Card className="space-y-3 p-4 md:p-5">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Node Detail</p>
          <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">节点详情</h3>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--line)] bg-white/60 px-4 py-8 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-[rgba(148,163,184,0.08)]">
            <SearchIcon className="size-5 text-[var(--muted)]" />
          </div>
          <p className="text-[12px] leading-6 text-[var(--muted)]">
            悬停或点击图中的节点查看记忆详情
          </p>
        </div>
      </Card>
    );
  }

  const node = props.node;
  const color = CATEGORY_COLORS[node.category];

  return (
    <Card className="space-y-4 p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}18` }}
        >
          {CATEGORY_ICON_COMPONENTS[node.category](`size-4.5`)}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold text-[var(--ink)]">{node.label}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em]"
              style={{ backgroundColor: `${color}14`, color }}
            >
              {CATEGORY_LABELS[node.category]}
            </span>
            <span className="rounded-full bg-[rgba(148,163,184,0.12)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--muted-strong)]">
              {node.scope === "global" ? "全局" : "会话"}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-[rgba(148,163,184,0.12)] bg-[linear-gradient(180deg,rgba(247,249,251,0.96),rgba(255,255,255,0.86))] px-4 py-3.5">
        <p className="text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]">Value</p>
        <p className="mt-2 whitespace-pre-wrap break-all text-[14px] leading-6 text-[var(--ink)]">
          {formatMemoryValue(node.value)}
        </p>
      </div>

      {typeof node.confidence === "number" ? (
        <ConfidenceBar value={node.confidence} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <MetaCard label="Key" value={node.key} mono title={node.key} />
        <MetaCard label="Branch" value={node.branch} mono title={node.branch} />
        <MetaCard
          label="Source"
          value={formatSourceEid(node.sourceEid)}
          mono
          title={node.sourceEid}
        />
        <MetaCard label="Updated" value={formatDateTime(node.updatedAt)} title={formatDateTime(node.updatedAt)} />
      </div>

      {props.highlightedCount > 0 ? (
        <div className="flex items-center gap-2 rounded-[12px] bg-[rgba(99,102,241,0.06)] px-3 py-2 text-[12px] text-[var(--muted-strong)]">
          <span className="inline-block size-1.5 rounded-full bg-[rgba(99,102,241,0.6)]" />
          关联节点 {props.highlightedCount} 个
        </div>
      ) : null}
    </Card>
  );
}
