import { Card } from "@clawbot/ui";
import { AccountFilters } from "./AccountFilters.js";
import { AccountTable } from "./AccountTable.js";
import { AccountTableFooter } from "./AccountTableFooter.js";
import { DashboardHeader } from "./DashboardHeader.js";
import { StatsGrid } from "./StatsGrid.js";
import { useAccountList } from "./useAccountList.js";

export function DashboardPage() {
  const {
    accounts,
    error,
    filteredAccounts,
    firstVisible,
    lastVisible,
    loading,
    page,
    query,
    refresh,
    setPage,
    setQuery,
    setSortKey,
    setStatus,
    sortKey,
    stats,
    status,
    tabCounts,
    visibleAccounts,
  } = useAccountList();

  return (
    <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
      <DashboardHeader onRefresh={refresh} />
      <StatsGrid stats={stats} />

      {error ? (
        <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
          加载账号失败：{error}
        </div>
      ) : null}

      <Card className="overflow-hidden !p-0">
        <AccountFilters
          query={query}
          onQueryChange={setQuery}
          sortKey={sortKey}
          onSortChange={setSortKey}
          status={status}
          onStatusChange={setStatus}
          tabCounts={tabCounts}
        />

        <AccountTable
          accounts={accounts}
          filteredCount={filteredAccounts.length}
          loading={loading}
          onRefresh={refresh}
          visibleAccounts={visibleAccounts}
        />

        {!loading && accounts.length > 0 ? (
          <AccountTableFooter
            firstVisible={firstVisible}
            lastVisible={lastVisible}
            onPageChange={setPage}
            page={page}
            total={filteredAccounts.length}
          />
        ) : null}
      </Card>
    </div>
  );
}
