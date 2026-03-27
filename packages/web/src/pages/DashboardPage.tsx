import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { AccountCard } from "../components/AccountCard.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  ActivityIcon,
  ArrowRightIcon,
  ChatIcon,
  ScanIcon,
  SearchIcon,
} from "../components/ui/icons.js";
import { formatCount } from "../lib/format.js";
import { useAccounts } from "../hooks/useAccounts.js";
import { buttonClassName } from "../components/ui/button.js";

export function DashboardPage() {
  const { accounts, loading, error, refresh } = useAccounts();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "online" | "offline">("all");
  const deferredQuery = useDeferredValue(query);
  const onlineCount = accounts.filter((account) => account.is_online).length;
  const offlineCount = accounts.length - onlineCount;
  const totalConversations = accounts.reduce(
    (sum, account) => sum + account.conversation_count,
    0
  );
  const normalized = deferredQuery.trim().toLowerCase();
  const visibleAccounts = [...accounts]
    .filter((account) => {
      if (status === "online" && !account.is_online) return false;
      if (status === "offline" && account.is_online) return false;

      if (!normalized) return true;

      const displayName = (account.display_name ?? "").toLowerCase();
      const id = account.id.toLowerCase();
      return displayName.includes(normalized) || id.includes(normalized);
    })
    .sort((left, right) => {
      if (left.is_online !== right.is_online) {
        return Number(right.is_online) - Number(left.is_online);
      }

      if (left.conversation_count !== right.conversation_count) {
        return right.conversation_count - left.conversation_count;
      }

      return right.created_at.localeCompare(left.created_at);
    });
  const stats = [
    { label: "纳管账号", value: formatCount(accounts.length), hint: "账号总数" },
    { label: "在线账号", value: formatCount(onlineCount), hint: "保持连接" },
    { label: "离线账号", value: formatCount(offlineCount), hint: "待重新连接" },
    { label: "归档会话", value: formatCount(totalConversations), hint: "全部会话数" },
  ];

  return (
    <div className="space-y-3 md:space-y-4">
      <section className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              Accounts
            </p>
            <h2 className="mt-1.5 text-[20px] text-[var(--ink)]">账号列表</h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">
              查看接入状态、会话规模，并直接进入指定账号的历史会话。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={refresh}>
              <ActivityIcon className="size-4" />
              刷新数据
            </Button>
            <Link to="/login" className={buttonClassName({ variant: "outline", size: "sm" })}>
              <ScanIcon className="size-4" />
              新增账号
            </Link>
          </div>
        </div>

        <div className="overflow-hidden border rounded-lg border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
          <div className="grid divide-y divide-[var(--line)] md:grid-cols-4 md:divide-x md:divide-y-0">
            {stats.map((stat) => (
              <div key={stat.label} className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  {stat.label}
                </p>
                <p className="mt-1.5 font-[var(--font-mono)] text-[18px] font-semibold text-[var(--ink)]">
                  {stat.value}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">{stat.hint}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载账号失败：{error}
        </div>
      ) : null}

      <section className="space-y-0">
        <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
          <div className="border-b border-[var(--line)] px-3 py-3 md:px-4">
          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-[280px]">
                <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索账号名称或 account id"
                  className="h-9 rounded-[8px] pl-10"
                />
              </div>

              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: "all", label: "全部" },
                  { key: "online", label: "在线" },
                  { key: "offline", label: "离线" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setStatus(item.key as typeof status)}
                    className={
                      status === item.key
                        ? "rounded-[8px] border border-[rgba(21,110,99,0.18)] bg-[rgba(21,110,99,0.08)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink)]"
                        : "rounded-[8px] border border-[var(--line)] bg-white/78 px-2.5 py-1.5 text-[11px] text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <ChatIcon className="size-4 text-[var(--muted-strong)]" />
              <span>当前筛选结果 {formatCount(visibleAccounts.length)} 个账号</span>
            </div>
          </div>
          </div>

          {loading ? (
            <div>
              <div className="hidden grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px] gap-3 border-b border-[var(--line)] bg-[rgba(246,249,250,0.92)] px-4 py-2.5 lg:grid">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="ui-skeleton h-3 rounded-full" />
                ))}
              </div>
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} className="grid gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px]">
                  <div className="ui-skeleton h-9 rounded-[6px]" />
                  <div className="ui-skeleton h-7 rounded-[6px]" />
                  <div className="ui-skeleton h-7 rounded-[6px]" />
                  <div className="ui-skeleton h-9 rounded-[6px]" />
                  <div className="ui-skeleton h-7 rounded-[6px]" />
                </div>
              ))}
            </div>
          ) : null}

          {!loading && accounts.length === 0 ? (
            <div className="grid gap-5 px-4 py-8 md:grid-cols-[minmax(0,1fr)_200px] md:items-end">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">暂无账号</p>
                <h3 className="mt-2 text-[18px] text-[var(--ink)]">先建立第一条连接</h3>
                <p className="mt-2 max-w-2xl text-[12px] leading-6 text-[var(--muted)]">
                  当前还没有可用账号。完成扫码登录后，控制台会自动出现账号，并允许直接查看会话归档。
                </p>
              </div>

              <Link to="/login" className={buttonClassName({ className: "justify-center", size: "sm" })}>
                打开扫码连接
                <ArrowRightIcon className="size-4" />
              </Link>
            </div>
          ) : null}

          {!loading && accounts.length > 0 ? (
            <div>
              <div className="hidden grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px] gap-3 border-b border-[var(--line)] bg-[rgba(246,249,250,0.92)] px-4 py-2.5 lg:grid">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">账号</p>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">状态</p>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">会话数</p>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">最近活跃</p>
                <p className="text-right text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  操作
                </p>
              </div>

              {visibleAccounts.length === 0 ? (
                <div className="px-5 py-9 text-center">
                  <p className="text-[13px] text-[var(--ink)]">没有匹配到账号</p>
                  <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                    可以尝试清空搜索词，或者切换在线状态筛选。
                  </p>
                </div>
              ) : (
                visibleAccounts.map((account) => <AccountCard key={account.id} account={account} onUpdate={refresh} />)
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
