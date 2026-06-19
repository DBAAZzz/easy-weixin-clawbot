import { useParams, useSearchParams } from "react-router-dom";
import type { ConversationRow } from "@clawbot/shared";
import { ActivityIcon, Button, ChevronLeftIcon } from "@clawbot/ui";
import { cn } from "@/lib/cn.js";
import { formatCount } from "@/lib/format.js";
import { useConversations } from "@/hooks/useConversations.js";
import { ConversationList } from "@/components/ConversationList.js";
import { NavItem } from "./NavItem.js";
import type { SidebarNavProps } from "./sidebarVariants.js";

function conversationTitle(conversation: ConversationRow): string {
  return conversation.title?.trim() || "未命名会话";
}

function conversationBadge(conversation: ConversationRow): string {
  return conversationTitle(conversation).slice(0, 1).toUpperCase() || "C";
}

export function ConversationSidebarNav({ collapsed }: SidebarNavProps) {
  const { accountId } = useParams<{ accountId: string }>();
  const { conversations, loading, error, refresh } = useConversations(accountId);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedConversationId = searchParams.get("conversation") ?? undefined;
  const select = (conversationId: string) => setSearchParams({ conversation: conversationId });

  // 折叠态：返回图标 + 首字母徽标按钮，仍可点击切换会话（hover 出原生 title 提示）。
  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center gap-1 overflow-y-auto py-1">
        <NavItem
          to="/"
          label="返回账号列表"
          icon={<ChevronLeftIcon className="size-4" />}
          collapsed
        />
        {conversations.map((conversation) => {
          const active = conversation.conversation_id === selectedConversationId;
          const title = conversationTitle(conversation);

          return (
            <button
              key={conversation.id}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => select(conversation.conversation_id)}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold transition duration-200 ease-expo",
                active
                  ? "bg-accent-mist text-accent-strong shadow-convo-active"
                  : "text-muted-strong hover:bg-white/72 hover:text-ink",
              )}
            >
              {conversationBadge(conversation)}
            </button>
          );
        })}
      </div>
    );
  }

  // 展开态：返回入口 + 账号头（固定）+ 会话列表（独立滚动，复用 ConversationList）。
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden">
      <div className="shrink-0">
        <NavItem
          to="/"
          label="返回账号列表"
          icon={<ChevronLeftIcon className="size-4" />}
          collapsed={false}
        />
      </div>

      <div className="flex min-w-0 shrink-0 items-start justify-between gap-3 px-3 pb-3 pt-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-label text-muted">账号</p>
          <p className="mt-1 truncate text-md font-semibold text-ink">
            {conversations[0]?.account_alias ||
              conversations[0]?.account_display_name ||
              accountId ||
              "未知账号"}
          </p>
          <p className="mt-0.5 text-sm text-muted">{formatCount(conversations.length)} 条会话</p>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mb-2 shrink-0 rounded-card border border-notice-error-border bg-notice-error-bg px-3 py-2 text-sm leading-5 text-red-700">
          加载会话列表失败：{error}
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden">
        {loading && conversations.length === 0 ? (
          <div className="space-y-0 px-2 py-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="ui-skeleton mb-1.5 h-16 rounded-card" />
            ))}
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            selectedConversationId={selectedConversationId}
            onSelect={select}
          />
        )}
      </div>
    </div>
  );
}
