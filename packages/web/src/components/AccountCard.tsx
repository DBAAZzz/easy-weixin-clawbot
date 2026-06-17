import type { AccountSummary } from "@clawbot/shared";
import { Link } from "react-router-dom";
import { useState } from "react";
import { formatCount, formatDateTime } from "../lib/format.js";
import { cn } from "../lib/cn.js";
import { Badge, Input } from "@clawbot/ui";
import { ArrowRightIcon, CheckIcon, PencilIcon, PulseIcon, XIcon } from "@clawbot/ui";
import { updateAccountAlias } from "@/api/accounts.js";

export function AccountCard({
  account,
  onUpdate,
}: {
  account: AccountSummary;
  onUpdate?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [alias, setAlias] = useState(account.alias ?? "");

  const handleSave = async () => {
    try {
      await updateAccountAlias(account.id, alias || null);
      setIsEditing(false);
      onUpdate?.();
    } catch (error) {
      console.error("Failed to update alias:", error);
    }
  };

  const displayName = account.alias || account.display_name || "未命名账号";
  const statusTone = account.deprecated ? "offline" : "online";
  const statusLabel = account.deprecated ? "已废弃" : "活跃";
  const dotClassName = account.deprecated ? "bg-account-muted-faint" : "bg-account-success-dot";

  return (
    <Link to={`/accounts/${encodeURIComponent(account.id)}`} className="group block">
      <article className="border-b border-account-line-soft transition duration-200 hover:bg-account-table-head last:border-b-0">
        <div className="hidden items-center px-6 py-3 lg:grid lg:account-table-grid">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex size-9 shrink-0 items-center justify-center rounded-panel border border-account-line-strong bg-account-filter-track text-account-muted-faint">
              <PulseIcon className="size-4" />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-account-card",
                  dotClassName,
                  !account.deprecated && "status-dot",
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div
                  className="flex items-center gap-1.5"
                  onClick={(event) => event.preventDefault()}
                >
                  <Input
                    value={alias}
                    onChange={(event) => setAlias(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleSave();
                      if (event.key === "Escape") {
                        setAlias(account.alias ?? "");
                        setIsEditing(false);
                      }
                    }}
                    className="h-8 max-w-sm rounded-card border-account-line-strong bg-account-card text-base font-semibold text-account-ink"
                    placeholder="设置别名"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleSave}
                    className="flex size-8 items-center justify-center rounded-card border border-account-line-strong bg-account-card text-account-success-fg transition hover:bg-account-table-head"
                  >
                    <CheckIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAlias(account.alias ?? "");
                      setIsEditing(false);
                    }}
                    className="flex size-8 items-center justify-center rounded-card border border-account-line-strong bg-account-card text-account-muted transition hover:bg-account-table-head"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="group/name flex items-center gap-1.5">
                  <p className="truncate text-sm font-semibold leading-tight text-account-ink">
                    {displayName}
                  </p>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      setIsEditing(true);
                    }}
                    className="flex size-6 items-center justify-center rounded-card text-account-muted-soft opacity-0 transition hover:bg-account-filter-track hover:text-account-ink group-hover/name:opacity-100"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                </div>
              )}
              <p className="mt-0.5 truncate font-mono text-xs tracking-body text-account-muted-soft">
                {account.id}
              </p>
            </div>
          </div>

          <div className="flex justify-center">
            <Badge
              tone={statusTone}
            >
              {statusLabel}
            </Badge>
          </div>

          <div className="text-center font-mono text-sm font-semibold text-account-ink-soft">
            {formatCount(account.conversation_count)}
          </div>

          <div>
            <p className="font-mono text-xs text-account-muted">
              {formatDateTime(account.created_at)}
            </p>
          </div>

          <div className="flex items-center justify-end gap-1.5 text-base font-semibold text-account-ink transition group-hover:text-accent">
            <span>查看会话</span>
            <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-3.5 lg:hidden">
          <div className="flex items-start gap-3">
            <div className="relative flex size-9 shrink-0 items-center justify-center rounded-panel border border-account-line-strong bg-account-filter-track text-account-muted-faint">
              <PulseIcon className="size-4" />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-account-card",
                  dotClassName,
                  !account.deprecated && "status-dot",
                )}
              />
            </div>

            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="space-y-2" onClick={(event) => event.preventDefault()}>
                  <Input
                    value={alias}
                    onChange={(event) => setAlias(event.target.value)}
                    className="h-8 rounded-card border-account-line-strong bg-account-card text-base font-semibold text-account-ink"
                    placeholder="设置别名"
                    autoFocus
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleSave}
                      className="inline-flex items-center gap-1 text-md font-semibold text-account-success-fg"
                    >
                      <CheckIcon className="size-4" /> 保存
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAlias(account.alias ?? "");
                        setIsEditing(false);
                      }}
                      className="inline-flex items-center gap-1 text-md font-medium text-account-muted"
                    >
                      <XIcon className="size-4" /> 取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold leading-tight text-account-ink">
                      {displayName}
                    </p>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        setIsEditing(true);
                      }}
                      className="flex size-6 items-center justify-center rounded-card text-account-muted-soft"
                    >
                      <PencilIcon className="size-4" />
                    </button>
                  </div>
                  <p className="mt-0.5 break-all font-mono text-xs text-account-muted-soft">
                    {account.id}
                  </p>
                </>
              )}
            </div>

            <Badge
              tone={statusTone}
            >
              {statusLabel}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-sm font-medium text-account-muted-soft">会话数</p>
              <p className="mt-1 font-mono text-sm font-semibold text-account-ink-soft">
                {formatCount(account.conversation_count)}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-account-muted-soft">创建时间</p>
              <p className="mt-1 font-mono text-sm text-account-muted">
                {formatDateTime(account.created_at)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-account-line pt-3">
            <span className="inline-flex items-center gap-1.5 text-base font-semibold text-account-ink">
              查看会话
              <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
