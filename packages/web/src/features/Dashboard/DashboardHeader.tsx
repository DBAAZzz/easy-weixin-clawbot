import { Button, PlusIcon, RefreshIcon, buttonClassName } from "@clawbot/ui";

export function DashboardHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
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
          onClick={onRefresh}
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
  );
}
