import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { useObservability } from "../hooks/useObservability.js";
import {
  formatCount,
  formatDateTime,
  formatMs,
  formatPercent,
  formatTokens,
  formatUsd,
} from "../lib/format.js";
import { Card } from "../components/ui/card.js";
import { Badge } from "../components/ui/badge.js";
import { Button, buttonClassName } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  RefreshIcon,
  SearchIcon,
  TerminalIcon,
} from "../components/ui/icons.js";
import { Select } from "../components/ui/select.js";
import { cn } from "../lib/cn.js";
import { buildTraceDetailPath, getTraceStatus } from "../lib/observability.js";
import { TraceFlagList } from "../components/observability/TraceFlagList.js";

const FLAG_OPTIONS = [
  { value: "", label: "全部标记" },
  { value: "error", label: "error" },
  { value: "max_rounds", label: "max_rounds" },
  { value: "slow", label: "slow" },
  { value: "expensive", label: "expensive" },
];

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "ok", label: "正常" },
  { value: "error", label: "异常" },
];

function MetricCard(props: { label: string; value: string; hint?: string; tooltip?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">{props.label}</p>
        {props.tooltip && (
          <span className="group relative">
            <svg className="size-3 cursor-help text-[var(--muted)] transition hover:text-[var(--ink)]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="6.5" />
              <path d="M6.2 6.5a1.8 1.8 0 0 1 3.5.5c0 1.2-1.7 1.2-1.7 2.2" strokeLinecap="round" />
              <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
            </svg>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-lg bg-[var(--ink)] px-3 py-2 text-[11px] leading-[1.6] text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              {props.tooltip}
            </span>
          </span>
        )}
      </div>
      <p className="font-[var(--font-mono)] text-[18px] font-semibold text-[var(--ink)]">
        {props.value}
      </p>
      {props.hint && <p className="text-[11px] text-[var(--muted)]">{props.hint}</p>}
    </div>
  );
}

function ChartList(props: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: string; ratio: number; meta?: string }>;
  empty: string;
}) {
  return (
    <Card className="space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">{props.title}</p>
        <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">{props.subtitle}</h3>
      </div>

      {props.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--line)] bg-white/52 px-4 py-5 text-[12px] text-[var(--muted)]">
          {props.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {props.rows.map((row) => (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <div className="min-w-0">
                  <p className="truncate text-[var(--ink)]">{row.label}</p>
                  {row.meta ? <p className="text-[11px] text-[var(--muted)]">{row.meta}</p> : null}
                </div>
                <span className="shrink-0 font-[var(--font-mono)] text-[11px] text-[var(--muted-strong)]">
                  {row.value}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[rgba(148,163,184,0.12)]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,rgba(21,110,99,0.82),rgba(15,118,110,0.42))]"
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

export function ObservabilityPage() {
  const [status, setStatus] = useState<"" | "ok" | "error">("");
  const [flag, setFlag] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const observability = useObservability({
    window: "24h",
    status: status || undefined,
    flag: flag || undefined,
    query: deferredQuery,
  });

  return (
    <div className="space-y-4 md:space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              Agent Observability
            </p>
            <h2 className="mt-1.5 text-[20px] text-[var(--ink)]">可观测性中心</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href="/api/metrics"
              target="_blank"
              rel="noreferrer"
              className={buttonClassName({ variant: "outline", size: "sm" })}
            >
              <TerminalIcon className="size-4" />
              打开 /api/metrics
            </a>
            <Button size="sm" onClick={observability.refresh}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
          </div>
        </div>

        {observability.error ? (
          <div className="rounded-lg border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
            加载可观测性数据失败：{observability.error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            label="请求总量"
            value={formatCount(observability.overview?.totals.requests ?? 0)}
          />
          <MetricCard
            label="平均耗时"
            value={formatMs(observability.overview?.totals.avg_duration_ms ?? 0)}
          />
          <MetricCard
            label="错误率"
            value={formatPercent(observability.overview?.totals.error_rate ?? 0)}
          />
          <MetricCard
            label="Token"
            value={formatTokens(observability.overview?.totals.token_total ?? 0)}
          />
          <MetricCard
            label="估算费用"
            value={formatUsd(observability.overview?.totals.estimated_cost_usd ?? 0)}
          />
          <MetricCard
            label="采样保留"
            value={formatCount(observability.overview?.totals.sampled_traces ?? 0)}
          />
        </div>
      </section>

      {/* ── 耗时分位 ── */}
      <section className="grid grid-cols-3 gap-x-6 xl:grid-cols-6">
        <MetricCard
          label="P50"
          value={formatMs(observability.overview?.latency_ms.p50 ?? 0)}
          hint="中位数"
          tooltip="50% 的请求在此耗时内完成，反映典型用户体验"
        />
        <MetricCard
          label="P95"
          value={formatMs(observability.overview?.latency_ms.p95 ?? 0)}
          hint="尾部延迟"
          tooltip="95% 的请求在此耗时内完成，剩余 5% 更慢——关注这个值能发现影响少数用户的性能问题"
        />
        <MetricCard
          label="P99"
          value={formatMs(observability.overview?.latency_ms.p99 ?? 0)}
          hint="极端慢请求"
          tooltip="99% 的请求在此耗时内完成，仅 1% 更慢——通常是超长工具调用或多轮对话导致"
        />
      </section>

      {/* ── 分布图表 ── */}
      <section className="grid gap-4 xl:grid-cols-3">
        <ChartList
          title="Rounds"
          subtitle="LLM 轮数分布"
          empty="当前窗口内没有 trace。"
          rows={(observability.overview?.round_distribution ?? []).map((item) => ({
            label: `${item.bucket} 轮`,
            value: `${formatCount(item.count)} · ${formatPercent(item.ratio)}`,
            ratio: item.ratio,
          }))}
        />

        <ChartList
          title="Tools"
          subtitle="工具调用 Top 5"
          empty="当前窗口内还没有工具调用。"
          rows={(observability.overview?.top_tools ?? []).map((item) => ({
            label: item.tool_name,
            value: formatCount(item.count),
            ratio: item.ratio,
            meta: `P95 ${formatMs(item.p95_ms)} · 错误率 ${formatPercent(item.error_rate)}`,
          }))}
        />

        <ChartList
          title="Flags"
          subtitle="异常标记分布"
          empty="当前窗口内没有 flags。"
          rows={(observability.overview?.flag_counts ?? [])
            .filter((item) => item.count > 0)
            .map((item) => ({
              label: item.flag,
              value: formatCount(item.count),
              ratio: item.ratio,
            }))}
        />
      </section>

      {/* ── Trace 列表 ── */}
      <section>
        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--line)] px-4 py-4">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Traces</p>
                <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">Trace 列表</h3>
              </div>

              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative w-full lg:w-[240px]">
                  <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索 trace / account / conversation"
                    className="h-9 rounded-[10px] pl-10"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Select
                    value={status}
                    onChange={(v) => setStatus(v as "" | "ok" | "error")}
                    options={STATUS_OPTIONS}
                    placeholder="全部状态"
                    size="sm"
                    className="w-[130px]"
                  />
                  <Select
                    value={flag}
                    onChange={setFlag}
                    options={FLAG_OPTIONS}
                    placeholder="全部标记"
                    size="sm"
                    className="w-[140px]"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-px bg-[var(--line)]">
            {observability.loadingTraces ? (
              Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="grid gap-3 bg-white/76 px-4 py-4">
                  <div className="ui-skeleton h-4 w-40 rounded-full" />
                  <div className="grid gap-2 md:grid-cols-4">
                    <div className="ui-skeleton h-3 rounded-full" />
                    <div className="ui-skeleton h-3 rounded-full" />
                    <div className="ui-skeleton h-3 rounded-full" />
                    <div className="ui-skeleton h-3 rounded-full" />
                  </div>
                </div>
              ))
            ) : observability.traces.length === 0 ? (
              <div className="bg-white/72 px-5 py-10 text-center">
                <p className="text-[13px] text-[var(--ink)]">当前筛选下没有 trace</p>
              </div>
            ) : (
              observability.traces.map((trace) => {
                const statusInfo = getTraceStatus(trace);

                return (
                  <Link
                    key={trace.trace_id}
                    to={buildTraceDetailPath(trace.trace_id)}
                    className={cn(
                      "grid gap-3 bg-white/76 px-4 py-4 text-left transition hover:bg-white",
                      "hover:ring-1 hover:ring-inset hover:ring-[rgba(21,110,99,0.15)]",
                    )}
                  >
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-[var(--font-mono)] text-[12px] text-[var(--ink)]">
                            {trace.trace_id}
                          </p>
                          <span className={cn("rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]", statusInfo.className)}>
                            {statusInfo.label}
                          </span>
                          {trace.sampled ? <Badge>sampled</Badge> : <Badge>summary only</Badge>}
                        </div>
                        <p className="mt-1 text-[11px] text-[var(--muted)]">
                          {trace.account_id} · {trace.conversation_id}
                        </p>
                      </div>

                      <span className="text-[11px] text-[var(--muted)]">
                        {formatDateTime(trace.created_at)}
                      </span>
                    </div>

                    <div className="grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg border border-[var(--line)] bg-[rgba(248,250,252,0.86)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Total</p>
                        <p className="mt-1 font-[var(--font-mono)] text-[12px] text-[var(--ink)]">
                          {formatMs(trace.total_ms)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[var(--line)] bg-[rgba(248,250,252,0.86)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Rounds</p>
                        <p className="mt-1 font-[var(--font-mono)] text-[12px] text-[var(--ink)]">
                          {formatCount(trace.llm_rounds)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[var(--line)] bg-[rgba(248,250,252,0.86)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Tools</p>
                        <p className="mt-1 font-[var(--font-mono)] text-[12px] text-[var(--ink)]">
                          {formatCount(trace.tool_calls)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[var(--line)] bg-[rgba(248,250,252,0.86)] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">Tokens</p>
                        <p className="mt-1 font-[var(--font-mono)] text-[12px] text-[var(--ink)]">
                          {formatTokens(trace.input_tokens + trace.output_tokens)}
                        </p>
                      </div>
                    </div>

                    <TraceFlagList flags={trace.flags} />
                  </Link>
                );
              })
            )}
          </div>

          {observability.hasMore ? (
            <div className="border-t border-[var(--line)] px-4 py-4">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-center"
                onClick={observability.loadMore}
                disabled={observability.loadingMore}
              >
                {observability.loadingMore ? "加载中..." : "加载更多 trace"}
              </Button>
            </div>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
