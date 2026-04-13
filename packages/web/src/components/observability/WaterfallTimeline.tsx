/**
 * WaterfallTimeline —— 瀑布流时序图
 *
 * 核心交互：
 * 1. 左侧：树形 span 名称（带连接线 + 缩进）
 * 2. 右侧：时间轴对齐的水平条（长度 = duration / traceTotal，位置 = startTime 偏移）
 * 3. 点击 span 行：展开下方 detail drawer（prompt/completion、属性明细）
 *
 * 布局：
 * ┌─────────────────────┬──────────────────────────────────────────┐
 * │  Span 名称 (固定宽)  │  ███████░░░░░░░░░░░░  耗时条 (弹性宽)    │
 * ├─────────────────────┼──────────────────────────────────────────┤
 * │  ├─ llm.call R1     │  ██████████████████░░  2,340ms           │
 * │  │  ├─ tool.search  │  ░░░░░░░░░░░░░░████░  890ms             │
 * │  │  └─ tool.weather │  ░░░░░░░░░░░░░░██░░░  120ms             │
 * │  └─ llm.call R2     │  ░░░░░░░░░░░░░░░████  680ms             │
 * └─────────────────────┴──────────────────────────────────────────┘
 */

import { useMemo, useState } from "react";
import type { ObservabilityTraceDetail, ObservabilityTraceSpan } from "@clawbot/shared";
import { formatMs, formatTokens } from "../../lib/format.js";
import { cn } from "../../lib/cn.js";
import { SpanGlyph } from "../../lib/observability.js";

// ── 数据准备 ──

interface FlatRow {
  span: ObservabilityTraceSpan;
  depth: number;
  llmRound: number | null;
  /** 是否是父节点的最后一个子节点（用于画树连接线） */
  isLast: boolean;
  /** 祖先链中哪些层级是"最后一个子节点"（决定是否画竖线） */
  ancestorIsLast: boolean[];
}

function buildRows(spans: ObservabilityTraceSpan[]): FlatRow[] {
  const byParent = new Map<string | null, ObservabilityTraceSpan[]>();
  for (const span of spans) {
    const key = span.parent_span_id;
    const bucket = byParent.get(key) ?? [];
    bucket.push(span);
    byParent.set(key, bucket);
  }

  // 按 start_time 排序子节点
  for (const children of byParent.values()) {
    children.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }

  const rows: FlatRow[] = [];
  const visited = new Set<string>();
  let llmRound = 0;

  const visit = (parentId: string | null, depth: number, ancestorIsLast: boolean[]) => {
    const children = byParent.get(parentId) ?? [];
    children.forEach((span, index) => {
      if (visited.has(span.span_id)) return;
      visited.add(span.span_id);

      if (span.name === "llm.call") llmRound += 1;

      const isLast = index === children.length - 1;
      rows.push({
        span,
        depth,
        llmRound: span.name === "llm.call" ? llmRound : null,
        isLast,
        ancestorIsLast: [...ancestorIsLast],
      });
      visit(span.span_id, depth + 1, [...ancestorIsLast, isLast]);
    });
  };

  visit(null, 0, []);

  // orphan spans
  for (const span of spans) {
    if (!visited.has(span.span_id)) {
      rows.push({ span, depth: 0, llmRound: null, isLast: true, ancestorIsLast: [] });
    }
  }

  return rows;
}

// ── 时间轴计算 ──

interface TimeAxis {
  /** trace 最早 start_time (ms timestamp) */
  origin: number;
  /** trace 总跨度 (ms) */
  total: number;
}

function computeTimeAxis(spans: ObservabilityTraceSpan[]): TimeAxis {
  if (spans.length === 0) return { origin: 0, total: 1 };
  const starts = spans.map((s) => new Date(s.start_time).getTime());
  const ends = spans.map((s) => new Date(s.start_time).getTime() + s.duration_ms);
  const origin = Math.min(...starts);
  const total = Math.max(1, Math.max(...ends) - origin);
  return { origin, total };
}

// ── span 类型 → 颜色 ──

const SPAN_COLORS: Record<string, { bar: string; bg: string; text: string }> = {
  "llm.call": {
    bar: "bg-indigo-500",
    bg: "bg-indigo-50",
    text: "text-indigo-700",
  },
  "tool.execute": {
    bar: "bg-amber-500",
    bg: "bg-amber-50",
    text: "text-amber-700",
  },
  "message.receive": {
    bar: "bg-slate-400",
    bg: "bg-slate-50",
    text: "text-slate-600",
  },
  "message.send": {
    bar: "bg-emerald-500",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
  },
  "conversation.lock": {
    bar: "bg-slate-300",
    bg: "bg-slate-50",
    text: "text-slate-500",
  },
};

const DEFAULT_SPAN_COLOR = {
  bar: "bg-teal-500",
  bg: "bg-teal-50",
  text: "text-teal-700",
};

function getSpanColor(name: string) {
  return SPAN_COLORS[name] ?? DEFAULT_SPAN_COLOR;
}

// ── span 显示名 ──

function getSpanTitle(span: ObservabilityTraceSpan, llmRound: number | null): string {
  if (span.name === "llm.call" && llmRound) return `LLM Round ${llmRound}`;
  if (span.name === "tool.execute" && span.tool_name) return span.tool_name;
  return span.name;
}

// ── 树连接线（纯 CSS） ──

const INDENT_WIDTH = 20; // px per depth level

function TreeLines({ row }: { row: FlatRow }) {
  if (row.depth === 0) return null;

  return (
    <>
      {/* 祖先层级的竖线 */}
      {row.ancestorIsLast.map((isLast, level) =>
        isLast ? null : (
          <span
            key={level}
            className="absolute top-0 h-full border-l border-slate-border-heavy"
            style={{ left: `${level * INDENT_WIDTH + 9}px` }}
          />
        ),
      )}

      {/* 当前节点的拐角线 */}
      <span
        className="absolute border-l border-b border-slate-border-heavy"
        style={{
          left: `${(row.depth - 1) * INDENT_WIDTH + 9}px`,
          top: 0,
          height: "50%",
          width: `${INDENT_WIDTH - 4}px`,
          borderBottomLeftRadius: "6px",
        }}
      />
    </>
  );
}

// ── Detail Drawer ──

function SpanDetail({ span }: { span: ObservabilityTraceSpan }) {
  const [tab, setTab] = useState<"attributes" | "prompt" | "completion">("attributes");
  const hasPayload = Boolean(span.payload);

  const tabs = [
    { key: "attributes" as const, label: "属性" },
    ...(hasPayload
      ? [
          { key: "prompt" as const, label: "Prompt" },
          { key: "completion" as const, label: "Completion" },
        ]
      : []),
  ];

  return (
    <div className="bg-pane-95 border-t border-line">
      {" "}
      <div className="flex items-center gap-1 border-b border-line px-4 py-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition",
              tab === t.key ? "bg-accent-soft text-ink" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="px-4 py-3">
        {tab === "attributes" && (
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Attr label="Span ID" value={span.span_id} mono />
            <Attr label="状态" value={span.status} />
            <Attr label="耗时" value={formatMs(span.duration_ms)} />
            {span.model && <Attr label="模型" value={span.model} />}
            {span.stop_reason && <Attr label="停止原因" value={span.stop_reason} />}
            {span.tool_name && <Attr label="工具" value={span.tool_name} />}
            {span.input_tokens != null && (
              <Attr label="输入 Token" value={formatTokens(span.input_tokens)} />
            )}
            {span.output_tokens != null && (
              <Attr label="输出 Token" value={formatTokens(span.output_tokens)} />
            )}
            {span.error_message && (
              <div className="sm:col-span-2 lg:col-span-3">
                <Attr label="错误" value={span.error_message} error />
              </div>
            )}
          </div>
        )}

        {tab === "prompt" && span.payload && (
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-white p-4 font-mono text-sm leading-6 text-ink">
            {span.payload.prompt || "(empty)"}
          </pre>
        )}

        {tab === "completion" && span.payload && (
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-white p-4 font-mono text-sm leading-6 text-ink">
            {span.payload.completion || "(empty)"}
          </pre>
        )}
      </div>
    </div>
  );
}

function Attr(props: { label: string; value: string; mono?: boolean; error?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{props.label}</p>
      <p
        className={cn(
          "mt-0.5 break-all text-base",
          props.error ? "text-red-600" : "text-ink",
          props.mono && "font-mono",
        )}
      >
        {props.value}
      </p>
    </div>
  );
}

// ── 时间轴刻度 ──

function TimeRuler({ total }: { total: number }) {
  const ticks = useMemo(() => {
    const count = 5;
    return Array.from({ length: count + 1 }, (_, i) => ({
      pct: (i / count) * 100,
      label: formatMs(Math.round((total * i) / count)),
    }));
  }, [total]);

  return (
    <div className="bg-pane-60 relative h-6 border-b h-full border-line">
      {" "}
      {ticks.map((tick) => (
        <span
          key={tick.pct}
          className="absolute top-0 flex h-full flex-col items-center justify-end"
          style={{ left: `${tick.pct}%`, transform: "translateX(-50%)" }}
        >
          <span className="text-2xs tabular-nums text-muted">{tick.label}</span>
          <span className="mt-0.5 h-1.5 border-l border-slate-border-heavy" />
        </span>
      ))}
    </div>
  );
}

// ── 主组件 ──

export function WaterfallTimeline({ trace }: { trace: ObservabilityTraceDetail }) {
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(trace.spans), [trace.spans]);
  const timeAxis = useMemo(() => computeTimeAxis(trace.spans), [trace.spans]);

  const NAME_COL_WIDTH = 260; // px

  return (
    <div className="overflow-hidden border border-line bg-white/90">
      {/* Header */}
      <div
        className="grid border-b px-4 border-line"
        style={{ gridTemplateColumns: `${NAME_COL_WIDTH}px 1fr` }}
      >
        <div className="border-r border-line px-4 py-2">
          <p className="text-xs uppercase tracking-caps-lg text-muted">
            Span · {rows.length} 个节点
          </p>
        </div>
        <TimeRuler total={timeAxis.total} />
      </div>

      {/* Rows */}
      <div>
        {rows.map((row) => {
          const color = getSpanColor(row.span.name);
          const isError = row.span.status === "error";
          const isExpanded = expandedSpanId === row.span.span_id;
          const startMs = new Date(row.span.start_time).getTime() - timeAxis.origin;
          const leftPct = (startMs / timeAxis.total) * 100;
          const widthPct = Math.max(0.5, (row.span.duration_ms / timeAxis.total) * 100);

          return (
            <div key={row.span.span_id}>
              <button
                type="button"
                onClick={() => setExpandedSpanId(isExpanded ? null : row.span.span_id)}
                className={cn(
                  "grid w-full text-left transition-colors",
                  isExpanded ? "bg-accent-hover" : "hover:bg-pane-80",
                  isError && "bg-red-50/40",
                )}
                style={{ gridTemplateColumns: `${NAME_COL_WIDTH}px 1fr` }}
              >
                {/* 左：span 名称 + 树线 */}
                <div
                  className="relative flex items-center gap-1.5 overflow-hidden border-r border-line py-2.5 pr-2"
                  style={{ paddingLeft: `${row.depth * INDENT_WIDTH + 12}px` }}
                >
                  <TreeLines row={row} />
                  <SpanGlyph
                    name={row.span.name}
                    className={cn("size-3.5 text-muted-strong", isError && "text-red-600")}
                  />
                  <span className={cn("truncate text-base", isError ? "text-red-600" : "text-ink")}>
                    {getSpanTitle(row.span, row.llmRound)}
                  </span>
                  {isError && (
                    <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-2xs font-semibold uppercase text-red-600">
                      err
                    </span>
                  )}
                </div>

                {/* 右：瀑布条 */}
                <div className="relative flex items-center py-2.5 pr-3">
                  <div
                    className={cn(
                      "absolute h-5 rounded-[4px] transition-opacity",
                      isError ? "bg-red-400/80" : color.bar,
                      "opacity-80 hover:opacity-100",
                    )}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      minWidth: "4px",
                    }}
                  />
                  {/* 耗时标签 */}
                  <span
                    className="relative z-10 whitespace-nowrap text-xs tabular-nums text-muted-strong"
                    style={{
                      marginLeft: `${Math.min(leftPct + widthPct + 1, 85)}%`,
                    }}
                  >
                    {formatMs(row.span.duration_ms)}
                    {row.span.input_tokens != null && (
                      <span className="ml-2 text-muted">
                        {formatTokens(row.span.input_tokens)}→
                        {formatTokens(row.span.output_tokens ?? 0)}
                      </span>
                    )}
                  </span>
                </div>
              </button>

              {/* 展开详情 */}
              {isExpanded && <SpanDetail span={row.span} />}
            </div>
          );
        })}
      </div>

      {/* Footer: legend */}
      <div className="flex flex-wrap gap-4 border-t border-line px-4 py-2.5">
        {[
          { name: "LLM", color: "bg-indigo-500" },
          { name: "Tool", color: "bg-amber-500" },
          { name: "Send", color: "bg-emerald-500" },
          { name: "Other", color: "bg-teal-500" },
          { name: "Error", color: "bg-red-400" },
        ].map((item) => (
          <div key={item.name} className="flex items-center gap-1.5">
            <span className={cn("inline-block h-2.5 w-5 rounded-sm", item.color)} />
            <span className="text-xs text-muted">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
