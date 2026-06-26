import type { ObservabilityTraceSummary, ObservabilityWindow } from "@clawbot/shared";
import "./observability.css";
import {
  Badge,
  Button,
  Card,
  ChevronRightIcon,
  Input,
  SearchIcon,
  Select,
  Toggle,
  ToggleGroup,
} from "@clawbot/ui";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useObservability } from "../../hooks/useObservability.js";
import { cn } from "../../lib/cn.js";
import {
  formatCount,
  formatMs,
  formatPercent,
  formatTime,
  formatTokens,
  formatUsd,
} from "../../lib/format.js";
import { buildTraceDetailPath } from "../../lib/observability.js";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import {
  BarDistributionChart,
  FLAG_OPTIONS,
  LatencyPanel,
  MetricCard,
  RoundDistributionChart,
  STATUS_OPTIONS,
  WINDOW_OPTIONS,
  type ObservabilityAccent,
} from "./components/index.js";

type TraceStatusFilter = "all" | "ok" | "error";

const TRACE_FLAG_LABELS: Record<string, string> = {
  error: "工具错误",
  max_rounds: "轮数上限",
  slow: "超时",
  expensive: "高费用",
};

const TRACE_FLAG_ACCENTS: Record<string, ObservabilityAccent> = {
  error: "danger",
  max_rounds: "accent",
  slow: "warning",
  expensive: "muted",
};

export function ObservabilityPage() {
  const [windowValue, setWindowValue] = useState<ObservabilityWindow>("24h");
  const [status, setStatus] = useState<TraceStatusFilter>("all");
  const [flag, setFlag] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const observability = useObservability({
    window: windowValue,
    status: status === "all" ? undefined : status,
    flag: flag || undefined,
    query: deferredQuery,
  });

  const overview = observability.overview;
  const totals = overview?.totals;
  const latency = overview?.latency_ms;
  const traceCount = observability.traces.length;

  const latencyMax = Math.max(latency?.p50 ?? 0, latency?.p95 ?? 0, latency?.p99 ?? 0, 1);

  const roundRows = useMemo(
    () =>
      (overview?.round_distribution ?? []).map((item) => ({
        label: item.bucket,
        value: formatTokens(item.count),
        ratio: item.ratio,
      })),
    [overview],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
      <DashboardHeader
        eyebrow="Observability"
        title="可观测性中心"
        description="监控全部账号的请求链路、耗时分位与异常标记"
        refreshLabel="刷新"
        onRefresh={observability.refresh}
      />

      <div className="flex justify-end">
        <ToggleGroup
          value={[windowValue]}
          onValueChange={(next) => {
            const [selected] = next;
            if (selected) setWindowValue(selected as ObservabilityWindow);
          }}
          size="sm"
          tone="ink"
          variant="segmented"
        >
          {WINDOW_OPTIONS.map((item) => (
            <Toggle
              key={item.value}
              value={item.value}
              className={cn(
                "px-3 font-mono text-md hover:text-account-ink-soft",
                windowValue === item.value ? "text-account-ink" : "text-account-muted",
              )}
            >
              {item.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>

      {observability.error ? (
        <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
          加载可观测性数据失败：{observability.error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="请求总量"
          value={formatCount(totals?.requests ?? 0)}
          meta={`${windowValue} 窗口`}
          accent="ink"
        />
        <MetricCard
          label="平均耗时"
          value={formatMs(totals?.avg_duration_ms ?? 0)}
          meta={`中位 ${formatMs(latency?.p50 ?? 0)}`}
          accent="accent"
        />
        <MetricCard
          label="错误率"
          value={formatPercent(totals?.error_rate ?? 0)}
          meta="异常 trace 占比"
          accent={(totals?.error_rate ?? 0) > 0 ? "danger" : "muted"}
        />
        <MetricCard
          label="Token"
          value={formatTokens(totals?.token_total ?? 0)}
          meta="输入 + 输出"
          accent="success"
        />
        <MetricCard
          label="估算费用"
          value={formatUsd(totals?.estimated_cost_usd ?? 0)}
          meta="按模型单价估算"
          accent="warning"
        />
        <MetricCard
          label="采样保留"
          value={formatCount(totals?.sampled_traces ?? 0)}
          meta="可下钻 Trace"
          accent="muted"
        />
      </section>

      <LatencyPanel
        items={[
          {
            label: "P50",
            value: formatMs(latency?.p50 ?? 0),
            ratio: ((latency?.p50 ?? 0) / latencyMax) * 100,
            accent: "success",
          },
          {
            label: "P95",
            value: formatMs(latency?.p95 ?? 0),
            ratio: ((latency?.p95 ?? 0) / latencyMax) * 100,
            accent: "warning",
          },
          {
            label: "P99",
            value: formatMs(latency?.p99 ?? 0),
            ratio: ((latency?.p99 ?? 0) / latencyMax) * 100,
            accent: "danger",
          },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-3">
        <RoundDistributionChart rows={roundRows} empty="当前窗口内没有 trace" />
        <BarDistributionChart
          title="工具调用 Top 5"
          subtitle="按调用次数排序"
          empty="当前窗口内还没有工具调用"
          rows={(overview?.top_tools ?? []).map((item) => ({
            label: item.tool_name,
            value: formatCount(item.count),
            ratio: item.ratio,
            meta: `P95 ${formatMs(item.p95_ms)} · 错误率 ${formatPercent(item.error_rate)}`,
            accent: "accent",
          }))}
        />
        <BarDistributionChart
          title="异常标记分布"
          subtitle="被自动标记的 Trace 类型"
          empty="当前窗口内没有异常标记"
          showDot
          rows={(overview?.flag_counts ?? [])
            .filter((item) => item.count > 0)
            .map((item) => ({
              label: TRACE_FLAG_LABELS[item.flag] ?? item.flag,
              value: formatCount(item.count),
              ratio: item.ratio,
              accent: TRACE_FLAG_ACCENTS[item.flag] ?? "muted",
            }))}
        />
      </section>

      <TraceList
        traces={observability.traces}
        query={query}
        flag={flag}
        status={status}
        totalLabel={`${formatCount(traceCount)} 条`}
        loading={observability.loadingTraces}
        loadingMore={observability.loadingMore}
        hasMore={observability.hasMore}
        onQueryChange={setQuery}
        onStatusChange={setStatus}
        onFlagChange={setFlag}
        onLoadMore={observability.loadMore}
      />
    </div>
  );
}

function TraceList({
  traces,
  query,
  flag,
  status,
  totalLabel,
  loading,
  loadingMore,
  hasMore,
  onQueryChange,
  onStatusChange,
  onFlagChange,
  onLoadMore,
}: {
  traces: ObservabilityTraceSummary[];
  query: string;
  flag: string;
  status: TraceStatusFilter;
  totalLabel: string;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: TraceStatusFilter) => void;
  onFlagChange: (value: string) => void;
  onLoadMore: () => void;
}) {
  return (
    <Card className="overflow-hidden rounded-section border-account-line bg-account-card !p-0 shadow-account-control backdrop-blur-none">
      <div className="flex flex-col gap-3 border-b border-account-line px-4 py-4 xl:flex-row xl:items-center xl:px-5">
        <div className="flex items-center gap-2 xl:mr-auto">
          <h2 className="text-lg font-bold text-account-ink">Trace 列表</h2>
          <span className="rounded-card bg-account-filter-track px-2 py-1 font-mono text-sm font-medium text-account-muted">
            {totalLabel}
          </span>
        </div>

        <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
          <div className="w-full md:w-observability-search">
            <Input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索 trace / account / conversation"
              leftIcon={<SearchIcon />}
              size="sm"
              inputClassName="rounded-card border-account-line-strong bg-account-card text-base placeholder:text-account-muted-faint focus:border-account-control-hover"
            />
          </div>

          <ToggleGroup
            value={[status]}
            onValueChange={(next) => {
              const [selected] = next;
              if (selected) onStatusChange(selected as TraceStatusFilter);
            }}
            size="sm"
            tone="ink"
            variant="segmented"
          >
            {STATUS_OPTIONS.map((item) => (
              <Toggle
                key={item.value}
                value={item.value}
                className={cn(
                  "gap-1.5 px-3 text-md hover:text-account-ink-soft",
                  status === item.value ? "text-account-ink" : "text-account-muted",
                )}
              >
                {item.value !== "all" ? (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      item.value === "error" ? "bg-state-error" : "bg-account-success-dot",
                    )}
                  />
                ) : null}
                {item.label}
              </Toggle>
            ))}
          </ToggleGroup>

          <Select
            value={flag}
            options={FLAG_OPTIONS}
            onChange={onFlagChange}
            size="sm"
            className="h-9 w-full rounded-card border border-account-line-strong bg-account-card px-3 text-md font-medium text-account-ink-soft shadow-account-control outline-none transition duration-200 ease-expo hover:border-account-control-hover hover:bg-account-table-head focus:border-account-control-hover focus:shadow-focus-accent md:w-observability-flag"
          />
        </div>
      </div>

      <div className="hidden border-b border-account-line bg-account-table-head px-5 py-3 lg:grid lg:observability-trace-grid">
        <p className="text-sm font-semibold tracking-body text-account-muted-soft">Trace</p>
        <p className="text-sm font-semibold tracking-body text-account-muted-soft">时间</p>
        <p className="text-sm font-semibold tracking-body text-account-muted-soft">
          耗时 / 轮数 / 工具 / Token
        </p>
        <p className="text-sm font-semibold tracking-body text-account-muted-soft">标记</p>
        <span />
      </div>

      <div>
        {loading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="grid gap-3 border-b border-account-line-soft px-5 py-4 last:border-b-0 lg:observability-trace-grid"
            >
              <div className="ui-skeleton h-5 rounded-card" />
              <div className="ui-skeleton h-5 rounded-card" />
              <div className="ui-skeleton h-5 rounded-card" />
              <div className="ui-skeleton h-5 rounded-card" />
              <div className="ui-skeleton h-5 rounded-card" />
            </div>
          ))
        ) : traces.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-base font-semibold text-account-muted">没有匹配的 Trace</p>
            <p className="mt-1 text-sm text-account-muted-faint">尝试调整搜索关键词或筛选条件</p>
          </div>
        ) : (
          traces.map((trace) => <TraceRow key={trace.trace_id} trace={trace} />)
        )}
      </div>

      {hasMore ? (
        <div className="flex justify-center border-t border-account-line px-5 py-4">
          <Button
            variant="secondary"
            size="sm"
            className="border-account-line-strong bg-account-card text-account-ink-soft shadow-account-control hover:border-account-control-hover hover:bg-account-table-head hover:text-account-ink-soft"
            onClick={onLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "加载中..." : "加载更多"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function TraceRow({ trace }: { trace: ObservabilityTraceSummary }) {
  const statusInfo = getTraceStatusView(trace);
  const tokenTotal = trace.input_tokens + trace.output_tokens;
  const isSlow = trace.total_ms >= 8_000 || trace.flags.includes("slow");

  return (
    <Link
      to={buildTraceDetailPath(trace.trace_id)}
      className="grid gap-3 border-b border-account-line-soft px-5 py-4 text-left transition duration-200 ease-expo hover:bg-account-table-head last:border-b-0 lg:observability-trace-grid"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("h-8 w-1 shrink-0 rounded-pill", statusInfo.accentClassName)} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-base font-medium text-account-ink">
              {trace.trace_id}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-card px-2 py-1 text-sm font-semibold",
                statusInfo.badgeClassName,
              )}
            >
              <span className={cn("size-1.5 rounded-full", statusInfo.dotClassName)} />
              {statusInfo.label}
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-xs text-account-muted-soft">
            {trace.account_id} · {trace.conversation_id}
          </p>
        </div>
      </div>

      <div className="font-mono text-sm font-medium text-account-muted lg:py-1.5">
        {formatTime(trace.created_at)}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <TraceMetric label="耗时" value={formatMs(trace.total_ms)} danger={isSlow} />
        <TraceMetric label="轮数" value={formatCount(trace.llm_rounds)} />
        <TraceMetric label="工具" value={formatCount(trace.tool_calls)} />
        <TraceMetric label="Token" value={formatTokens(tokenTotal)} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <TraceFlagBadges flags={trace.flags} sampled={trace.sampled} />
      </div>

      <ChevronRightIcon className="hidden size-4 text-account-muted-faint lg:block" />
    </Link>
  );
}

function TraceMetric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "truncate font-mono text-base font-semibold text-account-ink",
          danger && "text-danger",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-xs text-account-muted-faint">{label}</div>
    </div>
  );
}

function TraceFlagBadges({ flags, sampled }: { flags: string[]; sampled: boolean }) {
  if (flags.length === 0) {
    return <Badge>{sampled ? "sampled" : "summary"}</Badge>;
  }

  return (
    <>
      {flags.map((flag) => (
        <span
          key={flag}
          className={cn(
            "inline-flex rounded-card px-2 py-1 text-sm font-semibold",
            flag === "error" && "bg-notice-error-bg text-danger",
            flag === "slow" && "bg-notice-warning-bg text-notice-warning-fg",
            flag === "expensive" && "bg-account-filter-track text-account-muted",
            flag === "max_rounds" && "bg-accent-soft text-accent-strong",
          )}
        >
          {TRACE_FLAG_LABELS[flag] ?? flag}
        </span>
      ))}
    </>
  );
}

function getTraceStatusView(trace: ObservabilityTraceSummary) {
  if (trace.error || trace.flags.includes("error")) {
    return {
      label: "错误",
      accentClassName: "bg-state-error",
      dotClassName: "bg-state-error",
      badgeClassName: "bg-notice-error-bg text-danger",
    };
  }

  return {
    label: "成功",
    accentClassName: "bg-account-success-dot",
    dotClassName: "bg-account-success-dot",
    badgeClassName: "bg-account-success-bg text-account-success-fg",
  };
}
