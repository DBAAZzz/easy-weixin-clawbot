import type { TapeGraphNode } from "@clawbot/shared";
import { Card } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";

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
  fact: "事实",
  preference: "偏好",
  decision: "决策",
};

const CATEGORY_BADGE: Record<TapeGraphNode["category"], string> = {
  fact: "bg-account-muted",
  preference: "bg-account-success-dot",
  decision: "bg-danger",
};

const CATEGORY_DOT: Record<TapeGraphNode["category"], string> = {
  fact: "bg-account-muted",
  preference: "bg-account-success-dot",
  decision: "bg-danger",
};

interface MemoryTooltipProps {
  node: TapeGraphNode | null;
  degree: number;
  pinned: boolean;
  neighbors: TapeGraphNode[];
  onSelectNeighbor(node: TapeGraphNode): void;
}

export function MemoryTooltip(props: MemoryTooltipProps) {
  const { node } = props;

  if (!node) {
    return (
      <Card className="min-h-[232px] rounded-section border-account-line bg-account-card p-[18px] shadow-account-card backdrop-blur-none">
        <div className="flex h-[196px] flex-col items-center justify-center gap-3 text-center">
          <span className="inline-flex size-11 items-center justify-center rounded-control border border-account-line bg-account-page">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-account-muted-faint"
            >
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="18" cy="6" r="2.5" />
              <circle cx="12" cy="18" r="2.5" />
              <path d="M7.8 7.6 10.4 16M16.2 7.6 13.6 16" />
            </svg>
          </span>
          <div>
            <div className="text-lg font-semibold text-account-ink-soft">悬停或点击任一节点</div>
            <div className="mt-0.5 text-md text-account-muted-faint">查看记忆详情与关联关系</div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="min-h-[232px] rounded-section border-account-line bg-account-card p-[18px] shadow-account-card backdrop-blur-none">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-full px-2.5 text-base font-semibold text-white",
            CATEGORY_BADGE[node.category],
          )}
        >
          {CATEGORY_LABELS[node.category]}
        </span>
        {props.pinned ? (
          <span className="inline-flex items-center rounded-full bg-notice-error-bg px-2 py-0.5 text-sm font-semibold text-danger-strong">
            已选中
          </span>
        ) : null}
        <span className="ml-auto text-base text-account-muted-soft">
          关联 <b className="font-mono font-bold text-account-ink-soft">{props.degree}</b> 边
        </span>
      </div>

      <div className="mb-1.5 text-2xl font-bold leading-snug tracking-body text-account-ink">
        {node.label}
      </div>
      <div className="mb-3 break-all font-mono text-sm text-account-muted-soft">{node.key}</div>
      <p className="mb-3.5 text-md leading-relaxed text-account-ink-soft">
        {formatMemoryValue(node.value)}
      </p>

      <div className="mb-2 text-sm font-semibold uppercase tracking-label-lg text-account-muted-faint">
        关联节点
      </div>
      <div className="flex flex-col gap-1">
        {props.neighbors.length === 0 ? (
          <div className="px-2 py-1.5 text-md text-account-muted-faint">
            该节点为孤立记忆，暂无关联。
          </div>
        ) : (
          props.neighbors.map((neighbor) => (
            <button
              key={neighbor.id}
              type="button"
              onClick={() => props.onSelectNeighbor(neighbor)}
              className="flex items-center gap-2 rounded-card px-2 py-1.5 text-left transition-colors duration-200 ease-expo hover:bg-account-page"
            >
              <span
                className={cn("size-[7px] shrink-0 rounded-full", CATEGORY_DOT[neighbor.category])}
              />
              <span className="truncate text-md text-account-ink-soft">{neighbor.label}</span>
            </button>
          ))
        )}
      </div>
    </Card>
  );
}
