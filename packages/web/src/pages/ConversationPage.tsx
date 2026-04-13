import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ConversationList } from "../components/ConversationList.js";
import { MessageList } from "../components/MessageList.js";
import { Button } from "../components/ui/button.js";
import { ActivityIcon } from "../components/ui/icons.js";
import { formatCount, formatRelativeTime } from "../lib/format.js";
import { useConversations } from "../hooks/useConversations.js";
import { useMessages } from "../hooks/useMessages.js";

export function ConversationPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedConversationId = searchParams.get("conversation") ?? undefined;
  const { conversations, loading, error, refresh } = useConversations(accountId);
  const messages = useMessages(accountId, selectedConversationId);

  useEffect(() => {
    if (!conversations.length) return;

    const found = conversations.some(
      (conversation) => conversation.conversation_id === selectedConversationId,
    );

    if (selectedConversationId && found) return;

    setSearchParams({ conversation: conversations[0].conversation_id }, { replace: true });
  }, [conversations, selectedConversationId, setSearchParams]);

  const selectedConversation = conversations.find(
    (conversation) => conversation.conversation_id === selectedConversationId,
  );
  const conversationTitle = selectedConversation?.title ?? selectedConversationId ?? "未选择会话";
  const conversationMeta = selectedConversation
    ? `${formatCount(selectedConversation.message_count)} 条消息 · ${formatRelativeTime(selectedConversation.last_message_at)}`
    : null;
  const conversationBadge = conversationTitle.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <div className="grid h-full min-h-[640px] overflow-hidden rounded-lg border border-line-strong lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="bg-pane-78 flex min-h-0 flex-col border-r border-line backdrop-blur-sm">
        {" "}
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-label-lg text-muted">账号</p>
              <h2 className="mt-1.5 break-all text-2xl font-medium text-ink">
                {conversations[0]?.account_alias ||
                  conversations[0]?.account_display_name ||
                  accountId ||
                  "未知账号"}
              </h2>
              <p className="mt-1 text-sm text-muted">{formatCount(conversations.length)} 条会话</p>
            </div>

            <Button variant="outline" size="sm" onClick={refresh}>
              <ActivityIcon className="size-4" />
              刷新
            </Button>
          </div>

          {error ? (
            <div className="mt-3 border border-notice-error-border bg-notice-error-bg px-3 py-2 text-sm leading-5 text-red-700">
              加载会话列表失败：{error}
            </div>
          ) : null}
        </div>
        {loading && conversations.length === 0 ? (
          <div className="space-y-0 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="ui-skeleton h-16 border-b border-line last:border-b-0" />
            ))}
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            selectedConversationId={selectedConversationId}
            onSelect={(conversationId) => setSearchParams({ conversation: conversationId })}
          />
        )}
      </aside>

      <section className="flex min-h-0 flex-col bg-glass-74 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-base font-semibold text-accent-strong">
              {conversationBadge}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-medium text-ink">{conversationTitle}</p>
              {conversationMeta ? (
                <p className="mt-0.5 text-sm text-muted">{conversationMeta}</p>
              ) : null}
            </div>
          </div>

          <Button size="sm" variant="outline" onClick={messages.refresh}>
            <ActivityIcon className="size-4" />
            刷新消息
          </Button>
        </div>

        {messages.error ? (
          <div className="border-b border-notice-error-border bg-notice-error-bg px-4 py-2.5 text-sm leading-5 text-red-700">
            加载消息失败：{messages.error}
          </div>
        ) : null}

        <MessageList
          messages={messages.messages}
          loading={messages.loading}
          loadingMore={messages.loadingMore}
          hasMore={messages.hasMore}
          onLoadMore={messages.loadMore}
        />
      </section>
    </div>
  );
}
