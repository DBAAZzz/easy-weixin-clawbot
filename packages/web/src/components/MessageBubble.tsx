import type { MessageRow } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatTime } from "../lib/format.js";

function labelForRole(role: MessageRow["role"]) {
  switch (role) {
    case "user":
      return "用户";
    case "assistant":
      return "助手";
    case "toolResult":
      return "工具";
  }
}

export function MessageBubble({ message }: { message: MessageRow }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[82%] rounded-lg border px-3.5 py-3 shadow-[0_16px_30px_-28px_rgba(15,23,42,0.28)]",
          isUser
            ? "border-[var(--accent)] bg-[var(--accent)] text-white"
            : message.role === "toolResult"
              ? "border-[var(--line)] bg-[rgba(236,241,244,0.96)] text-[var(--ink)]"
              : "border-[var(--line)] bg-white/82 text-[var(--ink)]"
        )}
      >
        <div className="mb-2.5 flex items-center justify-between gap-3 text-[10px] tracking-[0.16em]">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 font-semibold",
              isUser
                ? "border-white/20 bg-white/10 text-white"
                : "border-[var(--line)] bg-white/72 text-[var(--muted-strong)]"
            )}
          >
            {labelForRole(message.role)}
          </span>
          <span
            className={cn(
              "font-[var(--font-mono)]",
              isUser ? "text-white/70" : "text-[var(--muted)]"
            )}
          >
            {formatTime(message.created_at)}
          </span>
        </div>
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-[13px] leading-6",
            message.role === "toolResult" && "font-[var(--font-mono)] text-[12px] leading-6"
          )}
        >
          {message.content_text ?? "[非文本内容]"}
        </p>
      </div>
    </div>
  );
}
