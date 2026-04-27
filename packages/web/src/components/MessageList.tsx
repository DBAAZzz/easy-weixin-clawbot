import { useCallback, useLayoutEffect, useRef } from "react";
import type { MessageRow } from "@clawbot/shared";
import { MessageBubble } from "./MessageBubble.js";
import { ScrollArea } from "./ui/scroll-area.js";

const LOAD_MORE_THRESHOLD = 48;
const BOTTOM_STICK_THRESHOLD = 96;

export function MessageList(props: {
  conversationId?: string;
  messages: MessageRow[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const { conversationId, hasMore, loading, loadingMore, messages, onLoadMore } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const conversationRef = useRef<string | undefined>(conversationId);
  const stickToBottomRef = useRef(true);
  const items = Array.isArray(messages) ? messages : [];

  const loadMoreFromTop = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;

    const scrollElement = scrollRef.current;
    if (scrollElement) {
      pendingPrependRef.current = {
        scrollHeight: scrollElement.scrollHeight,
        scrollTop: scrollElement.scrollTop,
      };
    }

    onLoadMore();
  }, [hasMore, loading, loadingMore, onLoadMore]);

  const handleScroll = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const distanceFromBottom =
      scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
    stickToBottomRef.current = distanceFromBottom <= BOTTOM_STICK_THRESHOLD;

    if (scrollElement.scrollTop <= LOAD_MORE_THRESHOLD) {
      loadMoreFromTop();
    }
  }, [loadMoreFromTop]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const conversationChanged = conversationRef.current !== conversationId;
    if (conversationChanged) {
      conversationRef.current = conversationId;
      pendingPrependRef.current = null;
      stickToBottomRef.current = true;
    }

    const pendingPrepend = pendingPrependRef.current;
    if (pendingPrepend) {
      const heightDelta = scrollElement.scrollHeight - pendingPrepend.scrollHeight;
      scrollElement.scrollTop = pendingPrepend.scrollTop + heightDelta;
      pendingPrependRef.current = null;
      return;
    }

    if (conversationChanged || stickToBottomRef.current) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  }, [conversationId, items.length]);

  return (
    <ScrollArea
      ref={scrollRef}
      onScroll={handleScroll}
      className="bg-quiet-surface min-h-0 flex-1 px-4 py-4"
    >
      <div className="flex min-h-full flex-col">
        <div className="flex min-h-8 items-center justify-center text-sm text-muted">
          {loadingMore ? (
            <span className="px-3 py-1.5">正在读取更早消息...</span>
          ) : hasMore && items.length > 0 ? (
            <span>滚动到顶部加载更早消息</span>
          ) : null}
        </div>

        {loading && items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 py-16">
            <div className="text-center">
              <div className="mx-auto size-2 rounded-full bg-accent" />
              <p className="mt-3 text-sm text-muted">正在读取消息...</p>
            </div>
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-3 pt-3">
          {!loading && items.length === 0 ? (
            <div className="rounded-card border border-dashed border-line px-4 py-10 text-center text-base leading-6 text-muted">
              这条会话还没有持久化消息记录。
            </div>
          ) : null}

          {items.map((message, index) => (
            <div
              key={message.id}
              className="reveal-up"
              style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            >
              <MessageBubble message={message} />
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}
