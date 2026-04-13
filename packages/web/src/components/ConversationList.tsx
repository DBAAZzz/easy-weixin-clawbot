import { useDeferredValue, useState } from "react";
import type { ConversationRow } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatCount, formatRelativeTime, formatTime } from "../lib/format.js";
import { Input } from "./ui/input.js";
import { SearchIcon } from "./ui/icons.js";
import { ScrollArea } from "./ui/scroll-area.js";

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
        const title = (conversation.title ?? conversation.conversation_id).toLowerCase();
        return title.includes(normalized);
      })
    : props.conversations;

  function badgeForConversation(conversation: ConversationRow) {
    const source = conversation.title ?? conversation.conversation_id;
    return source.trim().slice(0, 1).toUpperCase() || "C";
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line px-4 py-3">
        <label className="text-xs uppercase tracking-label-lg text-muted">搜索会话</label>
        <div className="relative mt-2.5">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索标题或 conversation id"
            className="h-9 rounded-lg pl-10"
          />
        </div>
        <p className="mt-1.5 text-sm text-muted">
          {formatCount(visibleConversations.length)} / {formatCount(props.conversations.length)}{" "}
          条结果
        </p>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 py-2">
        {visibleConversations.map((conversation, index) => {
          const active = conversation.conversation_id === props.selectedConversationId;

          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => props.onSelect(conversation.conversation_id)}
              className={cn(
                "reveal-up relative mb-1.5 w-full rounded-card px-3 py-2.5 text-left transition duration-200 ease-expo",
                active ? "bg-white shadow-convo-active" : "hover:bg-white/72",
              )}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              {active ? (
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent" />
              ) : null}

              <div className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-mist text-base font-semibold text-accent-strong">
                  {badgeForConversation(conversation)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-base font-medium text-ink">
                      {conversation.title ?? conversation.conversation_id}
                    </p>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {conversation.last_message_at
                        ? formatTime(conversation.last_message_at)
                        : "--:--"}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {conversation.conversation_id}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3 pl-12 text-xs text-muted">
                <span>{formatCount(conversation.message_count)} 条消息</span>
                <span>{formatRelativeTime(conversation.last_message_at)}</span>
              </div>
            </button>
          );
        })}

        {visibleConversations.length === 0 ? (
          <div className="rounded-card border border-dashed border-line px-4 py-6 text-base leading-6 text-muted">
            没有匹配到会话。可以尝试搜索标题片段，或者直接输入 conversation id。
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
