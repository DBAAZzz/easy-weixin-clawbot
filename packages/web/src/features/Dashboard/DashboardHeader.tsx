import { Button, PlusIcon, RefreshIcon, buttonClassName } from "@clawbot/ui";

export function DashboardHeader({
  eyebrow = "Accounts",
  title = "账号列表",
  description = "管理已接入的微信账号与其会话状态",
  primaryLabel = "新增账号",
  refreshLabel = "刷新数据",
  onCreate,
  onRefresh,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  primaryLabel?: string;
  refreshLabel?: string;
  onCreate?: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-caps-lg text-account-muted-soft">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-page-title font-bold leading-tight tracking-body text-account-ink">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-5 text-account-muted">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          className="border-account-line-strong bg-account-card text-account-ink-soft shadow-account-control hover:border-account-control-hover hover:bg-account-table-head hover:text-account-ink-soft"
        >
          <RefreshIcon className="size-4" />
          {refreshLabel}
        </Button>
        {onCreate ? (
          <Button
            onClick={onCreate}
            className={buttonClassName({
              variant: "primary",
              size: "sm",
            })}
          >
            {primaryLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
