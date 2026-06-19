import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { useObservability } from "../../hooks/useObservability.js";
import {
  formatCount,
  formatDateTime,
  formatMs,
  formatPercent,
  formatTokens,
  formatUsd,
} from "../../lib/format.js";
import { Card } from "@clawbot/ui";
import { Badge } from "@clawbot/ui";
import { Button } from "@clawbot/ui";
import { Input } from "@clawbot/ui";
import { SearchIcon } from "@clawbot/ui";
import { Select } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";
import { buildTraceDetailPath, getTraceStatus } from "../../lib/observability.js";
import { TraceFlagList } from "../../components/observability/TraceFlagList.js";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import { FLAG_OPTIONS, STATUS_OPTIONS, MetricCard, ChartList } from "./components.jsx";

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
    <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
      <DashboardHeader
        eyebrow="Agent Observability"
        title="可观测性中心"
        description="查看 Agent 请求、延迟、错误和 Trace"
        primaryLabel="打开 /api/metrics"
        refreshLabel="刷新"
        onCreate={() => window.open("/api/metrics", "_blank", "noopener,noreferrer")}
        onRefresh={observability.refresh}
      />

      <section className="space-y-3">
        {observability.error ? (
          <div className="rounded-lg border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
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
          <div className="border-b border-line px-4 py-4">
            <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
              <div>
                <p className="text-xs uppercase tracking-label-lg text-muted">Traces</p>
                <h3 className="mt-1.5 text-2xl text-ink">Trace 列表</h3>
              </div>

              <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                <div className="relative w-full lg:w-[240px]">
                  <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索 trace / account / conversation"
                    className="h-9 rounded-card pl-10"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Select
                    size="sm"
                    value={status}
                    onChange={(v) => setStatus(v as "" | "ok" | "error")}
                    options={STATUS_OPTIONS}
                    placeholder="全部状态"
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

          <div className="grid gap-px bg-line">
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
                <p className="text-md text-ink">当前筛选下没有 trace</p>
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
                      "hover:ring-1 hover:ring-inset hover:ring-accent-ring-soft",
                    )}
                  >
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-base text-ink">{trace.trace_id}</p>
                          <span
                            className={cn(
                              "rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-tag",
                              statusInfo.className,
                            )}
                          >
                            {statusInfo.label}
                          </span>
                          {trace.sampled ? <Badge>sampled</Badge> : <Badge>summary only</Badge>}
                        </div>
                        <p className="mt-1 text-sm text-muted">
                          {trace.account_id} · {trace.conversation_id}
                        </p>
                      </div>

                      <span className="text-sm text-muted">{formatDateTime(trace.created_at)}</span>
                    </div>

                    <div className="grid gap-2 md:grid-cols-4">
                      <div className="rounded-lg border border-line bg-frost-86 px-3 py-2">
                        <p className="text-xs uppercase tracking-caps-lg text-muted">Total</p>
                        <p className="mt-1 font-mono text-base text-ink">
                          {formatMs(trace.total_ms)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-frost-86 px-3 py-2">
                        <p className="text-xs uppercase tracking-caps-lg text-muted">Rounds</p>
                        <p className="mt-1 font-mono text-base text-ink">
                          {formatCount(trace.llm_rounds)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-frost-86 px-3 py-2">
                        <p className="text-xs uppercase tracking-caps-lg text-muted">Tools</p>
                        <p className="mt-1 font-mono text-base text-ink">
                          {formatCount(trace.tool_calls)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-line bg-frost-86 px-3 py-2">
                        <p className="text-xs uppercase tracking-caps-lg text-muted">Tokens</p>
                        <p className="mt-1 font-mono text-base text-ink">
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
            <div className="border-t border-line px-4 py-4">
              <Button
                variant="secondary"
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
