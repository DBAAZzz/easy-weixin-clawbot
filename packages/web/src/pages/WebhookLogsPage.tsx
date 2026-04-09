import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  ActivityIcon,
  RefreshIcon,
  WebhookIcon,
} from "../components/ui/icons.js";
import { useAsyncResource } from "../hooks/use-async-resource.js";
import {
  fetchAccounts,
  fetchWebhookLogs,
  fetchWebhookTokens,
} from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { formatCount, formatDateTime } from "../lib/format.js";

function MetricCard(props: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(255,255,255,0.82)] px-4 py-4">
      <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">{props.label}</p>
      <p className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-[var(--ink)]">
        {props.value}
      </p>
      <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{props.hint}</p>
    </div>
  );
}

function statusClassName(status: string) {
  return cn(
    "rounded-full px-2 py-0.5 text-[11px] font-medium",
    status === "success"
      ? "bg-emerald-50 text-emerald-700"
      : status === "rejected"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700"
  );
}

export function WebhookLogsPage() {
  const navigate = useNavigate();
  const params = useParams<{ source: string }>();
  const source = params.source ?? "";
  const [revision, setRevision] = useState(0);

  const {
    data: logsResp,
    loading: logsLoading,
    error: logsError,
  } = useAsyncResource(
    source ? () => fetchWebhookLogs(source, 200) : null,
    [revision, source]
  );
  const { data: tokensResp, loading: tokensLoading } = useAsyncResource(
    () => fetchWebhookTokens(),
    [revision]
  );
  const { data: accounts, loading: accountsLoading } = useAsyncResource(
    () => fetchAccounts(),
    [revision]
  );

  const logs = logsResp?.data ?? [];
  const tokens = tokensResp?.data ?? [];
  const token = tokens.find((item) => item.source === source) ?? null;
  const successCount = logs.filter((log) => log.status === "success").length;
  const rejectedCount = logs.filter((log) => log.status === "rejected").length;
  const errorCount = logs.length - successCount - rejectedCount;
  const latestLogAt = useMemo(() => {
    if (logs.length === 0) {
      return null;
    }

    return logs.reduce<string | null>((latest, log) => {
      if (!latest) return log.createdAt;
      return new Date(log.createdAt).getTime() > new Date(latest).getTime()
        ? log.createdAt
        : latest;
    }, null);
  }, [logs]);
  const activeAccountCount = new Set(logs.map((log) => log.accountId)).size;

  if (!source) {
    return (
      <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
        缺少 Webhook source，无法加载日志详情。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              Webhook Logs
            </p>
            <h2 className="mt-1.5 text-[24px] text-[var(--ink)]">
              {token?.source ?? source} 调用日志
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/webhooks")}>
              返回 Webhooks
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRevision((value) => value + 1)}>
              <ActivityIcon className="size-4" />
              刷新日志
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
          <Badge tone={token?.enabled ? "online" : "offline"}>
            {token?.enabled ? "Token 已启用" : "Token 已停用"}
          </Badge>
          <Badge tone="muted">日志 {formatCount(logs.length)}</Badge>
          <Badge tone="muted">账号 {formatCount(token?.accountIds.length ?? 0)}</Badge>
          <Badge tone="muted">
            最近调用 {latestLogAt ? formatDateTime(latestLogAt) : "暂无记录"}
          </Badge>
        </div>

        {token?.description ? (
          <div className="rounded-[16px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-4 py-2 text-[11px] text-[var(--muted)]">
            {token.description}
          </div>
        ) : null}
      </section>

      {logsError ? (
        <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载日志失败：{logsError}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total Events"
          value={formatCount(logs.length)}
          hint="当前窗口内抓取到的日志总量。"
        />
        <MetricCard
          label="Success"
          value={formatCount(successCount)}
          hint="成功写入微信或成功接受处理的请求。"
        />
        <MetricCard
          label="Rejected"
          value={formatCount(rejectedCount)}
          hint="被策略拒绝或参数校验未通过的请求。"
        />
        <MetricCard
          label="Failed"
          value={formatCount(errorCount)}
          hint="服务端异常或执行阶段失败的请求。"
        />
      </section>

      <section className="rounded-[22px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Insight Canvas
            </p>
          </div>
          <Badge tone="muted">Planning Space</Badge>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] border border-dashed border-[var(--line)] bg-white/66 px-4 py-5">
            <p className="text-[12px] font-medium text-[var(--ink)]">24h 请求趋势</p>
          </div>
          <div className="rounded-[18px] border border-dashed border-[var(--line)] bg-white/66 px-4 py-5">
            <p className="text-[12px] font-medium text-[var(--ink)]">状态分布</p>
          </div>
          <div className="rounded-[18px] border border-dashed border-[var(--line)] bg-white/66 px-4 py-5">
            <p className="text-[12px] font-medium text-[var(--ink)]">账号热度</p>
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Log Stream
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
            <Badge tone="muted">活跃账号 {formatCount(activeAccountCount)}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)}>
              <RefreshIcon className="size-3.5" />
              刷新
            </Button>
          </div>
        </div>

        {logsLoading || tokensLoading || accountsLoading ? (
          <div className="mt-4 grid gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="rounded-[18px] border border-[var(--line)] bg-white/80 px-4 py-4"
              >
                <div className="ui-skeleton h-4 rounded-[8px]" />
                <div className="mt-3 ui-skeleton h-3 rounded-[8px]" />
                <div className="mt-2 ui-skeleton h-3 w-4/5 rounded-[8px]" />
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="mt-4 rounded-[18px] border border-dashed border-[var(--line)] bg-white/60 px-4 py-8 text-center">
            <WebhookIcon className="mx-auto size-7 text-[var(--muted)]" />
            <p className="mt-3 text-[14px] text-[var(--muted-strong)]">暂无调用日志</p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-[18px] border border-[var(--line)] bg-white/90">
            <div className="overflow-x-auto">
              <table className="min-w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[rgba(247,250,251,0.84)] text-left text-[var(--muted)]">
                    <th className="px-4 py-3 font-medium">时间</th>
                    <th className="px-4 py-3 font-medium">账号</th>
                    <th className="px-4 py-3 font-medium">会话</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">错误</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, index) => {
                    const account = accounts?.find((item) => item.id === log.accountId);
                    return (
                      <tr key={`${log.conversationId}-${log.createdAt}-${index}`} className="border-b border-[var(--line)]/50 align-top last:border-b-0">
                        <td className="px-4 py-3 text-[var(--muted-strong)]">
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="min-w-[160px]">
                            <p className="text-[var(--ink)]">
                              {account?.alias || account?.display_name || log.accountId.slice(0, 12)}
                            </p>
                            <p className="mt-1 font-[var(--font-mono)] text-[11px] text-[var(--muted)]">
                              {log.accountId}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-[var(--font-mono)] text-[11px] text-[var(--muted)]">
                          {log.conversationId}
                        </td>
                        <td className="px-4 py-3">
                          <span className={statusClassName(log.status)}>{log.status}</span>
                        </td>
                        <td className="px-4 py-3 text-[11px] leading-5 text-[var(--muted-strong)]">
                          {log.error || "--"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
