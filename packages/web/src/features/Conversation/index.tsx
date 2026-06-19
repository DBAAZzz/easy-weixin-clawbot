import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { MessageList } from "../../components/MessageList.js";
import { Button } from "@clawbot/ui";
import { RefreshIcon } from "@clawbot/ui";
import { formatCount, formatRelativeTime } from "../../lib/format.js";
import { useConversations } from "../../hooks/useConversations.js";
import { useMessages } from "../../hooks/useMessages.js";

export function ConversationPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedConversationId = searchParams.get("conversation") ?? undefined;
  const { conversations } = useConversations(accountId);
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
  const conversationTitle = selectedConversation?.title?.trim() || "未选择会话";
  const conversationBadge = conversationTitle.trim().slice(0, 1).toUpperCase() || "C";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-glass-74 backdrop-blur-xl">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-mist text-sm font-semibold text-accent-strong">
            {conversationBadge}
          </span>
          <div className="min-w-0">
            <p className="truncate text-md font-semibold text-ink tracking-body">
              {conversationTitle}
            </p>
            {selectedConversation ? (
              <p className="mt-0.5 text-xs text-muted">
                {formatCount(selectedConversation.message_count)} 条消息
                <span className="mx-1.5 text-muted/40">·</span>
                {formatRelativeTime(selectedConversation.last_message_at)}
              </p>
            ) : null}
          </div>
        </div>

        <Button size="sm" variant="secondary" onClick={messages.refresh}>
          <RefreshIcon className="size-4" />
          刷新消息
        </Button>
      </div>

      {messages.error ? (
        <div className="shrink-0 border-b border-notice-error-border bg-notice-error-bg px-4 py-2.5 text-sm leading-5 text-red-700">
          加载消息失败：{messages.error}
        </div>
      ) : null}

      <MessageList
        conversationId={selectedConversationId}
        messages={messages.messages}
        loading={messages.loading}
        loadingMore={messages.loadingMore}
        hasMore={messages.hasMore}
        onLoadMore={messages.loadMore}
      />
    </div>
  );
}
