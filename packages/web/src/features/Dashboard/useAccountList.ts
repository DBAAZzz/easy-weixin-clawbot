import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { formatCount, formatPercent } from "../../lib/format.js";
import { useAccounts } from "../../hooks/useAccounts.js";
import { PAGE_SIZE, type AccountStat, type AccountStatus, type SortKey } from "./types.js";

export function useAccountList() {
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

  const stats: AccountStat[] = [
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

  return {
    accounts,
    loading,
    error,
    refresh,
    query,
    setQuery,
    status,
    setStatus,
    sortKey,
    setSortKey,
    page: safePage,
    setPage,
    filteredAccounts,
    visibleAccounts,
    firstVisible,
    lastVisible,
    tabCounts,
    stats,
  };
}
