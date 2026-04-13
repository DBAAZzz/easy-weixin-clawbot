import type { MessageRow } from "@clawbot/shared";
import { MessageBubble } from "./MessageBubble.js";
import { Button } from "./ui/button.js";
import { ScrollArea } from "./ui/scroll-area.js";

export function MessageList(props: {
  messages: MessageRow[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const items = Array.isArray(props.messages) ? props.messages : [];

  return (
    <ScrollArea className="bg-quiet-surface flex min-h-0 flex-1 flex-col px-4 py-4">
      {" "}
      <div className="flex flex-col gap-3">
        {props.hasMore ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={props.onLoadMore}
              disabled={props.loadingMore}
            >
              {props.loadingMore ? "正在读取更早消息..." : "加载更早消息"}
            </Button>
          </div>
        ) : null}

        {props.loading && items.length === 0 ? (
          <div className="space-y-3 px-1 py-2">
            <div className="ui-skeleton ml-auto h-[96px] w-[72%] rounded-lg" />
            <div className="ui-skeleton h-[112px] w-[78%] rounded-lg" />
            <div className="ui-skeleton ml-auto h-[84px] w-[66%] rounded-lg" />
          </div>
        ) : null}

        {!props.loading && items.length === 0 ? (
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
    </ScrollArea>
  );
}
