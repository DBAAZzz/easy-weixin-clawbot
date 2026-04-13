import type { AccountSummary } from "@clawbot/shared";
import { Link } from "react-router-dom";
import { useState } from "react";
import { formatCount, formatDateTime } from "../lib/format.js";
import { cn } from "../lib/cn.js";
import { Badge } from "./ui/badge.js";
import { ArrowRightIcon, ChatIcon, PencilIcon, CheckIcon, XIcon } from "./ui/icons.js";
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

  return (
    <Link to={`/accounts/${encodeURIComponent(account.id)}`} className="group block">
      <article className="border-b border-line last:border-b-0 transition duration-200 hover:bg-accent-hover">
        <div className="hidden min-h-[64px] grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px] items-center gap-3 px-4 py-2.5 lg:grid">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-account-avatar relative flex size-9 items-center justify-center rounded-xl border border-line">
              <span className="h-4.5 w-2.5 rounded-xs border border-line-strong bg-ink/8" />{" "}
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-white",
                  account.deprecated ? "bg-slate-300" : "bg-emerald-500 status-dot",
                )}
              />
            </div>
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="flex items-center gap-1.5" onClick={(e) => e.preventDefault()}>
                  <input
                    type="text"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave();
                      if (e.key === "Escape") {
                        setAlias(account.alias ?? "");
                        setIsEditing(false);
                      }
                    }}
                    className="w-96 h-7 rounded-lg border border-accent bg-white px-2 text-base font-medium text-ink outline-none ring-2 ring-ring-accent"
                    placeholder="设置别名"
                    autoFocus
                  />
                  <button
                    onClick={handleSave}
                    className="flex size-7 items-center justify-center rounded-md border border-line-strong bg-white text-emerald-600 transition hover:bg-emerald-50"
                  >
                    <CheckIcon className="size-4" />
                  </button>
                  <button
                    onClick={() => {
                      setAlias(account.alias ?? "");
                      setIsEditing(false);
                    }}
                    className="flex size-7 items-center justify-center rounded-md border border-line-strong bg-white text-muted transition hover:bg-slate-50"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              ) : (
                <div className="group/name flex items-center gap-1.5">
                  <p className="truncate text-base font-medium text-ink">{displayName}</p>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      setIsEditing(true);
                    }}
                    className="opacity-0 transition group-hover/name:opacity-100 flex size-6 items-center justify-center rounded text-muted hover:bg-white/60 hover:text-ink"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                </div>
              )}
              <p className="mt-0.5 truncate font-mono text-xs text-muted">{account.id}</p>
            </div>
          </div>

          <div>
            <Badge tone={statusTone}>{statusLabel}</Badge>
          </div>

          <div className="font-mono text-base text-ink">
            {formatCount(account.conversation_count)}
          </div>

          <div>
            <p className="font-mono text-xs text-muted">{formatDateTime(account.created_at)}</p>
          </div>

          <div className="flex items-center justify-end gap-2 text-sm font-medium text-ink">
            <span>查看会话</span>
            <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 lg:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="flex flex-col gap-2" onClick={(e) => e.preventDefault()}>
                  <input
                    type="text"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    className="w-full rounded-lg border border-accent bg-white px-2.5 py-1.5 text-base font-medium text-ink outline-none ring-2 ring-ring-accent"
                    placeholder="设置别名"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      className="flex items-center gap-1 text-sm font-medium text-emerald-600"
                    >
                      <CheckIcon className="size-3.5" /> 保存
                    </button>
                    <button
                      onClick={() => {
                        setAlias(account.alias ?? "");
                        setIsEditing(false);
                      }}
                      className="flex items-center gap-1 text-sm text-muted"
                    >
                      <XIcon className="size-3.5" /> 取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-base font-medium text-ink">{displayName}</p>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setIsEditing(true);
                      }}
                      className="flex size-5 items-center justify-center rounded text-muted"
                    >
                      <PencilIcon className="size-5" />
                    </button>
                  </div>
                  <p className="mt-0.5 break-all font-mono text-xs text-muted">{account.id}</p>
                </>
              )}
            </div>
            <Badge tone={statusTone}>{statusLabel}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs uppercase tracking-label text-muted">会话数</p>
              <p className="mt-0.5 font-mono text-md text-ink">
                {formatCount(account.conversation_count)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-label text-muted">创建时间</p>
              <p className="mt-0.5 text-base text-ink">{formatDateTime(account.created_at)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line pt-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <ChatIcon className="size-4 text-muted-strong" />
              <span>查看历史记录</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
              进入
              <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
