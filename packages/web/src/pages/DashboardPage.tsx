import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";
import { AccountCard } from "../components/AccountCard.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ActivityIcon, ChatIcon, ScanIcon, SearchIcon } from "../components/ui/icons.js";
import { formatCount } from "../lib/format.js";
import { useAccounts } from "../hooks/useAccounts.js";
import { buttonClassName } from "../components/ui/button.js";

export function DashboardPage() {
  const { accounts, loading, error, refresh } = useAccounts();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "deprecated">("all");
  const deferredQuery = useDeferredValue(query);
  const activeCount = accounts.filter((account) => !account.deprecated).length;
  const deprecatedCount = accounts.length - activeCount;
  const totalConversations = accounts.reduce((sum, account) => sum + account.conversation_count, 0);
  const normalized = deferredQuery.trim().toLowerCase();
  const visibleAccounts = [...accounts]
    .filter((account) => {
      if (status === "active" && account.deprecated) return false;
      if (status === "deprecated" && !account.deprecated) return false;

      if (!normalized) return true;

      const displayName = (account.display_name ?? "").toLowerCase();
      const id = account.id.toLowerCase();
      return displayName.includes(normalized) || id.includes(normalized);
    })
    .sort((left, right) => {
      // 活跃账号排前面
      if (left.deprecated !== right.deprecated) {
        return Number(left.deprecated) - Number(right.deprecated);
      }

      if (left.conversation_count !== right.conversation_count) {
        return right.conversation_count - left.conversation_count;
      }

      return right.created_at.localeCompare(left.created_at);
    });
  const stats = [
    { label: "纳管账号", value: formatCount(accounts.length), hint: "账号总数" },
    { label: "活跃账号", value: formatCount(activeCount), hint: "保持连接" },
    { label: "已废弃", value: formatCount(deprecatedCount), hint: "已被新扫码替代" },
    { label: "归档会话", value: formatCount(totalConversations), hint: "全部会话数" },
  ];

  return (
    <div className="space-y-3 md:space-y-4">
      <section className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Accounts</p>
            <h2 className="mt-1.5 text-4xl text-ink">账号列表</h2>
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

        <div className="overflow-hidden border rounded-lg border-line-strong bg-glass-74">
          <div className="grid divide-y divide-line md:grid-cols-4 md:divide-x md:divide-y-0">
            {stats.map((stat) => (
              <div key={stat.label} className="px-4 py-3">
                <p className="text-xs uppercase tracking-label-lg text-muted">{stat.label}</p>
                <p className="mt-1.5 font-mono text-3xl font-semibold text-ink">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载账号失败：{error}
        </div>
      ) : null}

      <section className="space-y-0">
        <div className="overflow-hidden rounded-lg border border-line-strong bg-glass-74">
          <div className="border-b border-line px-3 py-3 md:px-4">
            <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-[280px]">
                  <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索账号名称或 account id"
                    className="h-9 rounded-lg pl-10"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: "all", label: "全部" },
                    { key: "active", label: "活跃" },
                    { key: "deprecated", label: "已废弃" },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setStatus(item.key as typeof status)}
                      className={
                        status === item.key
                          ? "rounded-lg border border-accent-border-strong bg-accent-mist px-2.5 py-1.5 text-sm font-medium text-ink"
                          : "rounded-lg border border-line bg-white/78 px-2.5 py-1.5 text-sm text-muted-strong transition hover:border-line-strong hover:text-ink"
                      }
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted">
                <ChatIcon className="size-4 text-muted-strong" />
                <span>当前筛选结果 {formatCount(visibleAccounts.length)} 个账号</span>
              </div>
            </div>
          </div>

          {loading ? (
            <div>
              <div className="hidden grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px] gap-3 border-b border-line bg-table-header px-4 py-2.5 lg:grid">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="ui-skeleton h-3 rounded-full" />
                ))}
              </div>
              {Array.from({ length: 7 }).map((_, index) => (
                <div
                  key={index}
                  className="grid gap-3 border-b border-line px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px]"
                >
                  <div className="ui-skeleton h-9 rounded-md" />
                  <div className="ui-skeleton h-7 rounded-md" />
                  <div className="ui-skeleton h-7 rounded-md" />
                  <div className="ui-skeleton h-9 rounded-md" />
                  <div className="ui-skeleton h-7 rounded-md" />
                </div>
              ))}
            </div>
          ) : null}

          {!loading && accounts.length === 0 ? (
            <div className="grid gap-5 px-4 py-8 md:grid-cols-[minmax(0,1fr)_200px] md:items-end">
              <div>
                <p className="text-xs uppercase tracking-label-xl text-muted">暂无账号</p>
              </div>

              <Link
                to="/login"
                className={buttonClassName({
                  className: "w-full justify-center",
                  variant: "outline",
                  size: "sm",
                })}
              >
                <ScanIcon className="size-4" />
                打开扫码连接
              </Link>
            </div>
          ) : null}

          {!loading && accounts.length > 0 ? (
            <div>
              <div className="hidden grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px] gap-3 border-b border-line bg-table-header px-4 py-2.5 lg:grid">
                <p className="text-xs uppercase tracking-label-lg text-muted">账号</p>
                <p className="text-xs uppercase tracking-label-lg text-muted">状态</p>
                <p className="text-xs uppercase tracking-label-lg text-muted">会话数</p>
                <p className="text-xs uppercase tracking-label-lg text-muted">创建时间</p>
                <p className="text-right text-xs uppercase tracking-label-lg text-muted">操作</p>
              </div>

              {visibleAccounts.length === 0 ? (
                <div className="px-5 py-9 text-center">
                  <p className="text-md text-ink">没有匹配到账号</p>
                </div>
              ) : (
                visibleAccounts.map((account) => (
                  <AccountCard key={account.id} account={account} onUpdate={refresh} />
                ))
              )}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
