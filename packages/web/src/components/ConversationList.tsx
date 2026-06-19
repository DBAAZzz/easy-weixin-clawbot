import { useDeferredValue, useState } from "react";
import type { ConversationRow } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatCount, formatRelativeTime, formatTime } from "../lib/format.js";
import { Input } from "@clawbot/ui";
import { SearchIcon } from "@clawbot/ui";

function conversationDisplayTitle(conversation: ConversationRow): string {
  return conversation.title?.trim() || "未命名会话";
}

export function ConversationList(props: {
  conversations: ConversationRow[];
  selectedConversationId?: string;
  onSelect: (conversationId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const normalized = deferredQuery.trim().toLowerCase();
  const visibleConversations = normalized
    ? props.conversations.filter((conversation) => {
        const title = conversationDisplayTitle(conversation).toLowerCase();
        return (
          title.includes(normalized) ||
          conversation.conversation_id.toLowerCase().includes(normalized)
        );
      })
    : props.conversations;

  function badgeForConversation(conversation: ConversationRow) {
    const source = conversationDisplayTitle(conversation);
    return source.trim().slice(0, 1).toUpperCase() || "C";
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden">
      <div className="shrink-0 border-b border-line px-3 py-2.5">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索会话…"
          leftIcon={<SearchIcon />}
          size="sm"
          inputClassName="rounded-control"
        />
        {normalized ? (
          <p className="mt-2 text-xs text-muted">
            {formatCount(visibleConversations.length)} 条匹配
          </p>
        ) : null}
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1.5">
        {visibleConversations.map((conversation, index) => {
          const active = conversation.conversation_id === props.selectedConversationId;

          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => props.onSelect(conversation.conversation_id)}
              className={cn(
                "reveal-up relative mb-1 w-full min-w-0 overflow-hidden rounded-card px-3 py-2.5 text-left transition duration-200 ease-expo",
                active ? "bg-white shadow-convo-active" : "hover:bg-white/72",
              )}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              {active ? (
                <span className="absolute inset-y-2 left-0 w-0.75 rounded-full bg-accent" />
              ) : null}

              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-mist text-sm font-semibold text-accent-strong">
                  {badgeForConversation(conversation)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <p className="min-w-0 truncate text-md font-medium text-ink tracking-body">
                      {conversationDisplayTitle(conversation)}
                    </p>
                    <span className="shrink-0 font-mono text-2xs tracking-mono text-muted">
                      {conversation.last_message_at
                        ? formatTime(conversation.last_message_at)
                        : "--:--"}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-muted">
                    {formatCount(conversation.message_count)} 条消息
                    <span className="mx-1.5 text-muted/40">·</span>
                    {formatRelativeTime(conversation.last_message_at)}
                  </p>
                </div>
              </div>
            </button>
          );
        })}

        {visibleConversations.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-muted">
            {normalized ? "无匹配会话" : "暂无会话"}
          </p>
        ) : null}
      </div>
    </div>
  );
}
