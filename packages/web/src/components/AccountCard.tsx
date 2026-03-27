import type { AccountSummary } from "@clawbot/shared";
import { Link } from "react-router-dom";
import { formatCount, formatDateTime, formatRelativeTime } from "../lib/format.js";
import { cn } from "../lib/cn.js";
import { Badge } from "./ui/badge.js";
import { ArrowRightIcon, ChatIcon } from "./ui/icons.js";

export function AccountCard({ account }: { account: AccountSummary }) {
  return (
    <Link to={`/accounts/${encodeURIComponent(account.id)}`} className="group block">
      <article className="border-b border-[var(--line)] last:border-b-0 transition duration-200 hover:bg-[rgba(21,110,99,0.04)]">
        <div className="hidden min-h-[64px] grid-cols-[minmax(0,2.2fr)_108px_108px_148px_108px] items-center gap-3 px-4 py-2.5 lg:grid">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex size-9 items-center justify-center rounded-xl border border-[var(--line)] bg-[linear-gradient(180deg,rgba(243,247,248,0.92),rgba(233,238,241,0.88))]">
              <span className="h-4.5 w-2.5 rounded-[3px] border border-[var(--line-strong)] bg-[rgba(21,32,43,0.08)]" />
              <span
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border border-white",
                  account.is_online ? "bg-emerald-500 status-dot" : "bg-slate-300"
                )}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-[var(--ink)]">
                {account.display_name ?? "未命名账号"}
              </p>
              <p className="mt-0.5 truncate font-[var(--font-mono)] text-[10px] text-[var(--muted)]">
                {account.id}
              </p>
            </div>
          </div>

          <div>
            <Badge tone={account.is_online ? "online" : "offline"}>
              {account.is_online ? "在线" : "离线"}
            </Badge>
          </div>

          <div className="font-[var(--font-mono)] text-[12px] text-[var(--ink)]">
            {formatCount(account.conversation_count)}
          </div>

          <div>
            <p className="text-[12px] text-[var(--ink)]">
              {account.is_online ? "当前在线" : formatRelativeTime(account.last_seen_at)}
            </p>
            <p className="mt-0.5 font-[var(--font-mono)] text-[10px] text-[var(--muted)]">
              {formatDateTime(account.last_seen_at ?? account.created_at)}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 text-[11px] font-medium text-[var(--ink)]">
            <span>查看会话</span>
            <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
          </div>
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 lg:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-[var(--ink)]">
                {account.display_name ?? "未命名账号"}
              </p>
              <p className="mt-0.5 break-all font-[var(--font-mono)] text-[10px] text-[var(--muted)]">
                {account.id}
              </p>
            </div>
            <Badge tone={account.is_online ? "online" : "offline"}>
              {account.is_online ? "在线" : "离线"}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">会话数</p>
              <p className="mt-0.5 font-[var(--font-mono)] text-[13px] text-[var(--ink)]">
                {formatCount(account.conversation_count)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">最近活跃</p>
              <p className="mt-0.5 text-[12px] text-[var(--ink)]">
                {account.is_online ? "当前在线" : formatRelativeTime(account.last_seen_at)}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-[var(--line)] pt-3">
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <ChatIcon className="size-4 text-[var(--muted-strong)]" />
              <span>{account.is_online ? "可进入会话" : "查看历史记录"}</span>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--ink)]">
              进入
              <ArrowRightIcon className="size-4 transition group-hover:translate-x-0.5" />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
