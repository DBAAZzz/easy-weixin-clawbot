import type { AccountSummary } from "@clawbot/shared";
import { Link } from "react-router-dom";
import { Card, ScanIcon, buttonClassName } from "@clawbot/ui";
import { AccountCard } from "./AccountCard.js";
import { PAGE_SIZE } from "./types.js";

export function AccountTable({
  accounts,
  filteredCount,
  loading,
  onRefresh,
  visibleAccounts,
}: {
  accounts: AccountSummary[];
  filteredCount: number;
  loading: boolean;
  onRefresh: () => void;
  visibleAccounts: AccountSummary[];
}) {
  if (loading) {
    return (
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
    );
  }

  if (accounts.length === 0) {
    return (
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
            className: "justify-center text-button-primary-fg! md:justify-self-end",
            variant: "primary",
            size: "sm",
          })}
        >
          <ScanIcon className="size-4" />
          打开扫码连接
        </Link>
      </div>
    );
  }

  return (
    <div>
      <AccountTableHead />
      {filteredCount === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-base font-medium text-account-ink">没有匹配到账号</p>
        </div>
      ) : (
        visibleAccounts.map((account) => (
          <AccountCard key={account.id} account={account} onUpdate={onRefresh} />
        ))
      )}
    </div>
  );
}

function AccountTableHead() {
  return (
    <div className="hidden border-b border-account-line bg-account-table-head px-6 py-3 lg:grid lg:account-table-grid">
      <p className="text-sm font-semibold tracking-body text-account-muted-soft">账号</p>
      <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
        状态
      </p>
      <p className="text-center text-sm font-semibold tracking-body text-account-muted-soft">
        会话数
      </p>
      <p className="text-sm font-semibold tracking-body text-account-muted-soft">创建时间</p>
      <p className="text-right text-sm font-semibold tracking-body text-account-muted-soft">操作</p>
    </div>
  );
}
