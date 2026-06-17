import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AccountCard } from "../components/AccountCard.js";
import {
  Button,
  Card,
  Input,
  Pagination,
  PlusIcon,
  RefreshIcon,
  ScanIcon,
  SearchIcon,
  Select,
  Toggle,
  ToggleGroup,
  buttonClassName,
} from "@clawbot/ui";
import { formatCount, formatPercent } from "../lib/format.js";
import { useAccounts } from "../hooks/useAccounts.js";
import { cn } from "../lib/cn.js";

type AccountStatus = "all" | "active" | "deprecated";
type SortKey = "created" | "conversations" | "name";

const PAGE_SIZE = 10;

const statusOptions: Array<{ value: AccountStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "活跃" },
  { value: "deprecated", label: "已废弃" },
];

const sortOptions = [
  { value: "created", label: "最新创建" },
  { value: "conversations", label: "会话最多" },
  { value: "name", label: "名称排序" },
];

export function DashboardPage() {
  const { accounts, loading, error, refresh } = useAccounts();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<AccountStatus>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const activeCount = accounts.filter((account) => !account.deprecated).length;
  const deprecatedCount = accounts.length - activeCount;
  const totalConversations = accounts.reduce((sum, account) => sum + account.conversation_count, 0);
  const activeRatio = accounts.length > 0 ? activeCount / accounts.length : 0;
  const normalized = deferredQuery.trim().toLowerCase();

  const filteredAccounts = useMemo(
    () =>
      [...accounts]
        .filter((account) => {
          if (status === "active" && account.deprecated) return false;
          if (status === "deprecated" && !account.deprecated) return false;

          if (!normalized) return true;

          const displayName = (account.alias ?? account.display_name ?? "").toLowerCase();
          const id = account.id.toLowerCase();
          return displayName.includes(normalized) || id.includes(normalized);
        })
        .sort((left, right) => {
          if (sortKey === "conversations") {
            if (left.conversation_count !== right.conversation_count) {
              return right.conversation_count - left.conversation_count;
            }
          }

          if (sortKey === "name") {
            const leftName = left.alias ?? left.display_name ?? "";
            const rightName = right.alias ?? right.display_name ?? "";
            const nameCompare = leftName.localeCompare(rightName, "zh-CN");
            if (nameCompare !== 0) return nameCompare;
          }

          return right.created_at.localeCompare(left.created_at);
        }),
    [accounts, normalized, sortKey, status],
  );

  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleAccounts = filteredAccounts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const firstVisible = filteredAccounts.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const lastVisible = Math.min(safePage * PAGE_SIZE, filteredAccounts.length);
  const tabCounts: Record<AccountStatus, number> = {
    all: accounts.length,
    active: activeCount,
    deprecated: deprecatedCount,
  };
  const stats = [
    {
      label: "已有账号",
      value: formatCount(accounts.length),
      meta: "全部环境",
      dotClassName: "bg-account-ink",
      valueClassName: "text-account-ink",
    },
    {
      label: "活跃账号",
      value: formatCount(activeCount),
      meta: accounts.length > 0 ? `占比 ${formatPercent(activeRatio)}` : "占比 0%",
      dotClassName: "bg-account-success-dot",
      valueClassName: "text-account-success-fg",
    },
    {
      label: "已废弃账号",
      value: formatCount(deprecatedCount),
      meta: "已停用",
      dotClassName: "bg-account-muted-faint",
      valueClassName: "text-account-muted",
    },
    {
      label: "归档会话数",
      value: formatCount(totalConversations),
      meta: "累计",
      dotClassName: "bg-account-warning-dot",
      valueClassName: "text-account-ink",
    },
  ];

  useEffect(() => {
    setPage(1);
  }, [normalized, sortKey, status]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-caps-lg text-account-muted-soft">
            Accounts
          </p>
          <h1 className="mt-2 text-page-title font-bold leading-tight tracking-body text-account-ink">
            账号列表
          </h1>
          <p className="mt-2 text-sm leading-5 text-account-muted">
            管理已接入的微信账号与其会话状态
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            className="border-account-line-strong bg-account-card text-account-ink-soft shadow-account-control hover:border-account-control-hover hover:bg-account-table-head hover:text-account-ink-soft"
          >
            <RefreshIcon className="size-4" />
            刷新数据
          </Button>
          <Button
            className={buttonClassName({
              variant: "primary",
              size: "sm",
            })}
          >
            <PlusIcon className="size-4" />
            新增账号
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card
            key={stat.label}
            className="rounded-section border-account-line bg-account-card shadow-account-control backdrop-blur-none"
          >
            <div className="mb-3.5 flex items-center gap-2">
              <span className={cn("size-1.5 rounded-full", stat.dotClassName)} />
              <span className="text-sm font-medium text-account-muted">{stat.label}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-sans text-stat font-bold leading-none tracking-title",
                  stat.valueClassName,
                )}
              >
                {stat.value}
              </span>
              <span className="whitespace-nowrap text-sm text-account-muted-faint">
                {stat.meta}
              </span>
            </div>
          </Card>
        ))}
      </section>

      {error ? (
        <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
          加载账号失败：{error}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-section border border-account-line bg-account-card shadow-account-card">
        <div className="flex flex-col gap-4 border-b border-account-line px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-5">
          <ToggleGroup
            value={[status]}
            onValueChange={(nextStatus) => {
              const [selectedStatus] = nextStatus;
              if (selectedStatus) {
                setStatus(selectedStatus as AccountStatus);
              }
            }}
            size="sm"
            tone="ink"
            variant="segmented"
          >
            {statusOptions.map((item) => (
              <Toggle
                key={item.value}
                value={item.value}
                className={cn(
                  "gap-2 px-3 text-md hover:text-account-ink-soft",
                  status === item.value ? "text-account-ink" : "text-account-muted",
                )}
              >
                {item.label}
                <span
                  className={cn(
                    "rounded-pill px-1.5 py-0.5 font-mono text-sm font-semibold text-account-muted-soft",
                    status === item.value && "bg-account-filter-track text-account-muted",
                  )}
                >
                  {formatCount(tabCounts[item.value])}
                </span>
              </Toggle>
            ))}
          </ToggleGroup>

          <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
            <div className="w-full md:w-account-search">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索账号名称或 ID"
                leftIcon={<SearchIcon />}
                size="sm"
                inputClassName="rounded-card border-account-line-strong bg-account-card text-base placeholder:text-account-muted-faint focus:border-account-control-hover"
              />
            </div>

            <Select
              value={sortKey}
              options={sortOptions}
              onChange={(value) => setSortKey(value as SortKey)}
              size="sm"
              className="w-full border-account-line-strong bg-account-card text-md text-account-ink-soft hover:border-account-control-hover hover:bg-account-table-head md:w-account-sort"
            />
          </div>
        </div>

        {loading ? (
          <div>
            <div className="hidden border-b border-account-line bg-account-table-head px-6 py-3 lg:grid lg:account-table-grid">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="ui-skeleton h-3 rounded-pill" />
              ))}
            </div>
            {Array.from({ length: PAGE_SIZE }).map((_, index) => (
              <div
                key={index}
                className="grid gap-3 border-b border-account-line-soft px-6 py-4 last:border-b-0 lg:account-table-grid"
              >
                <div className="ui-skeleton h-10 rounded-panel" />
                <div className="ui-skeleton h-7 rounded-pill" />
                <div className="ui-skeleton h-7 rounded-card" />
                <div className="ui-skeleton h-7 rounded-card" />
                <div className="ui-skeleton h-7 rounded-card" />
              </div>
            ))}
          </div>
        ) : null}

        {!loading && accounts.length === 0 ? (
          <div className="grid gap-5 px-5 py-10 md:grid-cols-2 md:items-end">
            <div>
              <p className="text-base font-semibold uppercase tracking-caps-lg text-account-muted-soft">
                暂无账号
              </p>
              <p className="mt-2 text-base text-account-muted">扫码连接后会显示在这里</p>
            </div>

            <Link
              to="/login"
              className={buttonClassName({
                className: "justify-center !text-button-primary-fg md:justify-self-end",
                variant: "primary",
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
            <div className="hidden border-b border-account-line bg-account-table-head px-6 py-3 lg:grid lg:account-table-grid">
              <p className="text-sm font-semibold tracking-body text-account-muted-soft">账号</p>
              <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
                状态
              </p>
              <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
                会话数
              </p>
              <p className="text-sm font-semibold tracking-body text-account-muted-soft">
                创建时间
              </p>
              <p className="text-right text-sm font-semibold tracking-body text-account-muted-soft">
                操作
              </p>
            </div>

            {filteredAccounts.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-base font-medium text-account-ink">没有匹配到账号</p>
              </div>
            ) : (
              visibleAccounts.map((account) => (
                <AccountCard key={account.id} account={account} onUpdate={refresh} />
              ))
            )}
          </div>
        ) : null}

        {!loading && accounts.length > 0 ? (
          <div className="flex flex-col gap-3 bg-account-table-head px-5 py-3.5 md:flex-row md:items-center md:justify-between md:px-6">
            <span className="text-sm text-account-muted-soft">
              共{" "}
              <span className="font-mono font-semibold text-account-ink-soft">
                {formatCount(filteredAccounts.length)}
              </span>{" "}
              个账号 · 显示 {formatCount(firstVisible)}–{formatCount(lastVisible)}
            </span>
            <Pagination
              page={safePage}
              total={filteredAccounts.length}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
