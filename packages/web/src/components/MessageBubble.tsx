import type { MessageRow } from "@clawbot/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn.js";
import { formatFullDateTime } from "../lib/format.js";
import { Accordion } from "./ui/accordion.js";
import { TerminalIcon } from "./ui/icons.js";
import "./message-markdown.css";

function formatToolContent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return value;

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
}

function summarizeToolContent(value: string) {
  const firstLine = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return "无文本输出";
  return firstLine.length > 72 ? `${firstLine.slice(0, 72)}...` : firstLine;
}

function formatToolStats(value: string) {
  const lineCount = value.trim() ? value.split(/\r?\n/u).length : 0;
  return `${lineCount} 行 · ${value.length} 字符`;
}

export function MessageBubble({ message }: { message: MessageRow }) {
  const isUser = message.role === "user";
  const isToolResult = message.role === "toolResult";
  const content = message.content_text ?? "[非文本内容]";
  const toolContent = isToolResult ? formatToolContent(content) : content;

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[86%] rounded-lg border px-3.5 py-3 shadow-bubble",
          isUser
            ? "border-accent bg-accent text-white"
            : isToolResult
              ? "border-line bg-tool-result text-ink"
              : "border-line bg-white/82 text-ink",
        )}
      >
        <div className={cn("mb-2.5 flex text-xs", isUser ? "justify-end" : "justify-start")}>
          <span
            className={cn(
              "shrink-0 font-mono text-xs tracking-normal",
              isUser ? "text-white/70" : "text-muted",
            )}
          >
            {formatFullDateTime(message.created_at)}
          </span>
        </div>
        {isToolResult ? (
          <Accordion
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-line bg-white/80 text-muted-strong">
                  <TerminalIcon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">工具输出</span>
                  <span className="mt-0.5 block truncate text-xs font-normal tracking-normal text-muted">
                    {summarizeToolContent(toolContent)}
                  </span>
                </span>
              </span>
            }
            meta={<span className="font-mono tracking-normal">{formatToolStats(toolContent)}</span>}
            className="bg-pane-90"
            contentClassName="bg-white/72"
          >
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-base leading-6 text-ink-soft">
              {toolContent}
            </pre>
          </Accordion>
        ) : (
          <div className={cn("message-markdown", isUser && "message-markdown-inverted")}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ children, ...anchorProps }) => (
                  <a {...anchorProps} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
