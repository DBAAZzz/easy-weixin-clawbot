import {
  Card,
  Heatmap,
  LineChart,
  Select,
  type HeatmapCell,
  type LineChartSeries,
} from "@clawbot/ui";
import type { UsageOverview } from "@clawbot/shared";
import { useMemo, useState, type ReactNode } from "react";
import { useUsageOverview } from "../../hooks/useUsageOverview.js";
import { useAccounts } from "../../hooks/useAccounts.js";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import { formatCount, formatTokens } from "../../lib/format.js";

const SERIES_COLORS = [
  "var(--color-accent)",
  "var(--color-accent-strong)",
  "var(--color-account-muted-strong)",
  "var(--color-account-ink-soft)",
  "var(--color-account-muted)",
];

const CARD_CLASS =
  "rounded-section border-account-line bg-account-card shadow-account-control backdrop-blur-none";

export function UsagePage() {
  const [accountId, setAccountId] = useState("");
  const { accounts } = useAccounts();
  const { overview, error, refresh } = useUsageOverview(accountId || undefined);

  const accountOptions = useMemo(
    () => [
      { value: "", label: "全部账号" },
      ...accounts.map((account) => ({
        value: account.id,
        label: account.display_name || account.id,
      })),
    ],
    [accounts],
  );

  const cells = useMemo<HeatmapCell[]>(() => {
    if (!overview) return [];
    return overview.activity_days.map((day) => ({
      date: day.date,
      level: day.level,
      label: (
        <>
          <div>{day.date}</div>
          <div>
            {day.request_count} 次请求 · {formatTokens(day.token_total)} tokens
          </div>
        </>
      ),
    }));
  }, [overview]);

  const series = useMemo<LineChartSeries[]>(() => {
    if (!overview) return [];
    const byModel = new Map<string, { x: string; y: number }[]>();
    for (const row of overview.token_series) {
      const points = byModel.get(row.model) ?? [];
      points.push({ x: row.date, y: row.total_tokens });
      byModel.set(row.model, points);
    }
    return overview.model_totals.map((model, index) => ({
      name: model.model,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      points: byModel.get(model.model) ?? [],
    }));
  }, [overview]);

  const totals = overview?.totals;

  return (
    <div className="flex flex-col gap-6">
      <DashboardHeader
        eyebrow="Usage"
        title="使用分析"
        description="Agent 使用活跃与 token 消耗"
        onRefresh={refresh}
      />

      <div className="flex">
        <Select value={accountId} onChange={setAccountId} options={accountOptions} size="sm" />
      </div>

      {error ? (
        <div className="rounded-card border border-dashed border-account-line bg-account-table-head px-4 py-3 text-base text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="请求总量" value={formatCount(totals?.requests ?? 0)} />
        <Metric label="Token 总量" value={formatTokens(totals?.token_total ?? 0)} />
        <Metric label="日均请求" value={formatCount(totals?.avg_daily_requests ?? 0)} />
        <Metric label="日均 Token" value={formatTokens(totals?.avg_daily_tokens ?? 0)} />
      </div>

      <ChartCard title="活跃热力图" subtitle="近一年每日请求活跃度">
        {cells.length ? (
          <div className="overflow-x-auto">
            <Heatmap cells={cells} />
          </div>
        ) : (
          <ChartEmpty>暂无数据</ChartEmpty>
        )}
      </ChartCard>

      <ChartCard title="Token 消耗" subtitle="近 30 天各模型 token 用量">
        {series.length ? (
          <>
            <LineChart series={series} />
            <Legend totals={overview!.model_totals} />
          </>
        ) : (
          <ChartEmpty>暂无数据</ChartEmpty>
        )}
      </ChartCard>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className={CARD_CLASS}>
      <div className="text-sm font-medium text-account-muted">{label}</div>
      <div className="mt-3 font-sans text-2xl font-bold leading-none tracking-title text-account-ink">
        {value}
      </div>
    </Card>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Card className={CARD_CLASS}>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-account-ink">{title}</h2>
        <p className="mt-1 text-sm text-account-muted">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}

function ChartEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-account-line bg-account-table-head px-4 py-5 text-base text-account-muted">
      {children}
    </div>
  );
}

function Legend({ totals }: { totals: UsageOverview["model_totals"] }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {totals.map((model, index) => (
        <div key={model.model} className="flex items-center gap-2 text-sm">
          <span
            className="size-2 rounded-pill"
            style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
          />
          <span className="text-account-ink">{model.model}</span>
          <span className="ml-auto font-mono text-account-muted">
            {formatTokens(model.total_tokens)} · {Math.round(model.ratio * 100)}%
          </span>
        </div>
      ))}
    </div>
  );
}
