import { useState } from "react";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE, type MessageRow } from "@clawbot/shared";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/cn.js";
import { formatFullDateTime } from "../lib/format.js";
import { Accordion } from "@clawbot/ui";
import { ChevronDownIcon, PulseIcon, TerminalIcon } from "@clawbot/ui";
import "./message-markdown.css";

type MessageContentBlock = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTextBlock(block: MessageContentBlock): block is MessageContentBlock & { text: string } {
  return block.type === MESSAGE_CONTENT_TYPE.TEXT && typeof block.text === "string";
}

function getPayload(message: MessageRow) {
  if (isRecord(message.payload)) {
    return message.payload;
  }

  if (typeof message.payload !== "string") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(message.payload);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getPayloadContent(message: MessageRow): MessageContentBlock[] {
  const payload = getPayload(message);
  const content = payload.content;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function stripInjectedUserContext(text: string) {
  return text
    .replace(/<memory>[\s\S]*?<\/memory>\s*/giu, "")
    .replace(/<visual_context(?:\s[^>]*)?>[\s\S]*?<\/visual_context>\s*/giu, "")
    .replace(/^\[当前时间:[^\]]+\]\s*/u, "")
    .replace(/^\[图片：[^\]]+\]\s*/gmu, "")
    .trim();
}

function getTextBlocks(message: MessageRow): string[] {
  const blocks = getPayloadContent(message);
  if (blocks.length === 0 && message.content_text) {
    const fallbackText =
      message.role === MESSAGE_ROLE.USER
        ? stripInjectedUserContext(message.content_text)
        : message.content_text;
    return fallbackText ? [fallbackText] : [];
  }

  return blocks
    .filter(isTextBlock)
    .map((block) =>
      message.role === MESSAGE_ROLE.USER ? stripInjectedUserContext(block.text) : block.text.trim(),
    )
    .filter(Boolean);
}

function getImageBlocks(message: MessageRow) {
  return getPayloadContent(message)
    .filter((block) => block.type === MESSAGE_CONTENT_TYPE.IMAGE)
    .map((block) => ({
      src: typeof block.filePath === "string" ? block.filePath : null,
      mimeType: typeof block.mimeType === "string" ? block.mimeType : null,
    }));
}

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

function getThinkingBlocks(message: MessageRow) {
  return getPayloadContent(message)
    .filter(
      (block) => block.type === MESSAGE_CONTENT_TYPE.THINKING && typeof block.thinking === "string",
    )
    .map((block) => String(block.thinking).trim())
    .filter(Boolean);
}

function getToolCallBlocks(message: MessageRow) {
  return getPayloadContent(message)
    .filter((block) => block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL)
    .map((block) => ({
      id: typeof block.id === "string" ? block.id : null,
      name: typeof block.name === "string" ? block.name : "tool",
      arguments: isRecord(block.arguments) ? block.arguments : {},
    }));
}

function getToolName(message: MessageRow) {
  const payload = getPayload(message);
  return typeof payload.toolName === "string" ? payload.toolName : "tool";
}

function getToolText(message: MessageRow) {
  const text = getTextBlocks(message).join("\n\n");
  return formatToolContent(text || message.content_text || "");
}

function ToolUsageList({ tools }: { tools: MessageRow[] }) {
  if (tools.length === 0) return null;

  return (
    <div className="mt-2.5 space-y-1.5">
      {tools.map((tool) => {
        const toolContent = getToolText(tool);
        const toolName = getToolName(tool);

        return (
          <Accordion
            key={tool.id}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-card border border-line bg-glass-80 text-muted-strong">
                  <TerminalIcon className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{toolName}</span>
                  <span className="mt-0.5 block truncate text-xs font-normal text-muted">
                    {summarizeToolContent(toolContent)}
                  </span>
                </span>
              </span>
            }
            meta={<span className="font-mono tracking-mono">{formatToolStats(toolContent)}</span>}
            className="rounded-card bg-pane-90 shadow-none"
            contentClassName="bg-glass-72"
          >
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-sm leading-6 text-ink-soft">
              {toolContent || "无文本输出"}
            </pre>
          </Accordion>
        );
      })}
    </div>
  );
}

function formatThoughtDuration(messages: MessageRow[], finalMessage: MessageRow) {
  const first = messages[0];
  if (!first) return null;

  const startedAt = new Date(first.created_at).getTime();
  const endedAt = new Date(finalMessage.created_at).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
    return null;
  }

  const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
  return `思考过程 · ${seconds} 秒`;
}

function ThoughtPanel(props: {
  finalMessage: MessageRow;
  thoughts: MessageRow[];
  tools: MessageRow[];
}) {
  const [open, setOpen] = useState(false);
  const { finalMessage, thoughts, tools } = props;
  const thinking = thoughts.flatMap(getThinkingBlocks);
  const toolCalls = thoughts.flatMap(getToolCallBlocks);
  const hasProcess = thinking.length > 0 || toolCalls.length > 0 || tools.length > 0;
  const label = formatThoughtDuration(thoughts, finalMessage) ?? "思考过程";

  if (!hasProcess) return null;

  return (
    <div className="mb-3 border-b border-line pb-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-2 text-left text-sm font-medium text-muted-strong transition duration-200 ease-expo hover:text-ink focus-visible:outline-none focus-visible:shadow-focus-accent"
      >
        <PulseIcon className="size-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDownIcon
          className={cn("size-4 shrink-0 transition duration-200 ease-expo", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="mt-3 space-y-3 border-l border-line pl-3">
          {thinking.length > 0 ? (
            <div className="message-markdown text-muted-strong">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking.join("\n\n")}</ReactMarkdown>
            </div>
          ) : null}

          {toolCalls.length > 0 ? (
            <div className="space-y-1.5">
              {toolCalls.map((toolCall, index) => (
                <div
                  key={toolCall.id ?? `${toolCall.name}-${index}`}
                  className="rounded-card border border-line bg-pane-90 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-ink">
                    <TerminalIcon className="size-3.5 text-muted-strong" />
                    <span>{toolCall.name}</span>
                  </div>
                  {Object.keys(toolCall.arguments).length > 0 ? (
                    <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-strong">
                      {JSON.stringify(toolCall.arguments, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          <ToolUsageList tools={tools} />
        </div>
      ) : null}
    </div>
  );
}

export function MessageBubble({
  message,
  thoughts = [],
  tools = [],
}: {
  message: MessageRow;
  thoughts?: MessageRow[];
  tools?: MessageRow[];
}) {
  const isUser = message.role === MESSAGE_ROLE.USER;
  const textBlocks = getTextBlocks(message);
  const imageBlocks = isUser ? getImageBlocks(message) : [];
  const hasContent = textBlocks.length > 0 || imageBlocks.length > 0;
  const hasProcess = !isUser && (thoughts.length > 0 || tools.length > 0);
  const hasBubble = hasContent || hasProcess;

  if (!hasBubble && !isUser) {
    return null;
  }

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div className={cn("mb-1 flex max-w-[86%]", isUser ? "justify-end" : "justify-start")}>
        <span className="font-mono text-xs tracking-mono text-muted">
          {formatFullDateTime(message.created_at)}
        </span>
      </div>

      {hasBubble ? (
        <div
          className={cn(
            "max-w-[86%] rounded-panel border px-3.5 py-3 shadow-bubble",
            isUser ? "border-accent bg-accent text-white" : "border-line bg-glass-82 text-ink",
          )}
        >
          {!isUser ? (
            <ThoughtPanel finalMessage={message} thoughts={thoughts} tools={tools} />
          ) : null}

          {textBlocks.length > 0 ? (
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
                {textBlocks.join("\n\n")}
              </ReactMarkdown>
            </div>
          ) : null}

          {imageBlocks.length > 0 ? (
            <div className={cn("grid gap-2", textBlocks.length > 0 && "mt-2.5")}>
              {imageBlocks.map((image, index) =>
                image.src ? (
                  <img
                    key={`${image.src}-${index}`}
                    src={image.src}
                    alt={image.mimeType ? `图片 ${image.mimeType}` : "图片"}
                    className="max-h-88 max-w-full rounded-panel border border-line object-contain"
                  />
                ) : (
                  <div
                    key={index}
                    className="rounded-card border border-line px-3 py-2 text-base text-muted"
                  >
                    图片
                  </div>
                ),
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {!hasBubble ? (
        <div
          className={cn(
            "max-w-[86%] rounded-panel border px-3.5 py-3 text-sm shadow-bubble",
            isUser ? "border-accent bg-accent text-white" : "border-line bg-glass-82 text-muted",
          )}
        >
          非文本内容
        </div>
      ) : null}

      {isUser ? (
        <div className="max-w-[86%]">
          <ToolUsageList tools={tools} />
        </div>
      ) : null}
    </div>
  );
}
