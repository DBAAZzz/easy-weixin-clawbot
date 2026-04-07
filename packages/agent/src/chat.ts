/**
 * chat() — core conversation orchestration.
 *
 * Loads history + tape memory → builds user message → runs LLM → persists → extracts memory.
 * Decoupled from transport layer — no HTTP, no WeChat, no Prisma.
 */

import {
  type AssistantMessage,
  type ImageContent,
  type Message,
  type TextContent,
  type ToolResultMessage,
} from "@mariozechner/pi-ai";
import { withSpan } from "@clawbot/observability";
import { readFileSync } from "node:fs";
import type { AgentRunner } from "./runner.js";
import { resolveModel } from "./model-resolver.js";
import type { ChatResponse, ChatMedia } from "./types.js";
import { isDebugEnabled } from "./commands/debug.js";
import { ensureHistoryLoaded, getHistory, nextSeq, rollbackMessages } from "./conversation/index.js";
import { getMessageStore } from "./ports/message-store.js";
import {
  emptyState,
  recall,
  compactIfNeeded,
  formatMemoryForPrompt,
  fireExtractAndRecord,
} from "./tape/index.js";
import { extractMediaFromText } from "./media.js";

/** Detect image MIME type from file header magic bytes. */
function detectImageMime(buf: Buffer): string | null {
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  if (buf[0] === 0x42 && buf[1] === 0x4D) return "image/bmp";
  return null;
}

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractToolResultText(message: ToolResultMessage): string {
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || "[non-text tool result]";
}

function finalizeReply(
  text: string,
  fallback: string,
  debug?: { accountId: string; conversationId: string; startedAt: number; rounds: number },
): ChatResponse {
  const raw = text || fallback;
  const { cleanText, media } = extractMediaFromText(raw);

  let finalText = cleanText || undefined;
  if (finalText && debug && isDebugEnabled(debug.accountId, debug.conversationId)) {
    const elapsed = Date.now() - debug.startedAt;
    finalText += `\n\n---\n⏱ ${debug.rounds} round(s), ${elapsed}ms`;
  }

  const response: ChatResponse = { text: finalText };
  if (media) response.media = media;
  return response;
}

export interface ChatDeps {
  runner: AgentRunner;
  log: {
    llm(accountId: string, round: number): void;
    tool(name: string, args: Record<string, unknown>, result: string): void;
    done(accountId: string, rounds: number, ms: number): void;
  };
}

let _deps: ChatDeps | null = null;

export function setChatDeps(deps: ChatDeps): void {
  _deps = deps;
}

function getDeps(): ChatDeps {
  if (!_deps) throw new Error("ChatDeps not initialized — call setChatDeps() at startup");
  return _deps;
}

export async function chat(
  accountId: string,
  conversationId: string,
  text: string,
  media?: ChatMedia,
  startedAt = Date.now(),
): Promise<ChatResponse> {
  const { runner, log } = getDeps();
  const messageStore = getMessageStore();

  // Resolve the chat model dynamically based on account/conversation context
  const chatModel = await resolveModel(accountId, conversationId, "chat");

  return withSpan(
    "agent.chat",
    { model: chatModel.modelId, hasMedia: Boolean(media) },
    async () => {
      // Load message history and tape memory in parallel
      const [, [sessionMemory, globalMemory]] = await Promise.all([
        withSpan("history.load", { conversationId, accountId }, () =>
          ensureHistoryLoaded(accountId, conversationId),
        ),
        withSpan("tape.recall", { conversationId, accountId }, () =>
          Promise.all([
            recall(accountId, conversationId),
            recall(accountId, "__global__"),
          ]).catch((err) => {
            console.warn("[tape] recall failed, proceeding without memory:", err);
            return [emptyState(), emptyState()] as const;
          }),
        ),
      ]);

      const history = getHistory(accountId, conversationId);

      const memoryContext = formatMemoryForPrompt(globalMemory, sessionMemory);
      const now = new Date();
      const timePrefix = `[当前时间: ${now.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })}]\n`;

      const textParts = [timePrefix];
      if (memoryContext) textParts.push(memoryContext + "\n");
      textParts.push(text || "(no text)");

      const userContent: (TextContent | ImageContent)[] = [
        { type: "text", text: textParts.join("") },
      ];

      if (media?.type === "image") {
        const buf = readFileSync(media.filePath);
        const mimeType = detectImageMime(buf) ?? media.mimeType;
        const data = buf.toString("base64");
        if (mimeType !== media.mimeType) {
          console.log(`[chat] image mimeType corrected: ${media.mimeType} → ${mimeType}`);
        }
        userContent.push({
          type: "image",
          data,
          mimeType: mimeType as ImageContent["mimeType"],
        });
      }

      const userMessage: Message = {
        role: "user",
        content: userContent,
        timestamp: Date.now(),
      };

      history.push(userMessage);
      messageStore.queuePersistMessage({
        accountId,
        conversationId,
        message: userMessage,
        seq: nextSeq(accountId, conversationId),
        mediaSourcePath: media?.type === "image" ? media.filePath : undefined,
      });

      const pendingToolArgs = new Map<string, Record<string, unknown>>();
      let rounds = 0;
      let messagesAddedInRun = 0;

      const result = await runner.run(
        history,
        {
          onRoundStart(round) {
            rounds = round;
            log.llm(accountId, round);
          },

          onMessage(message: Message) {
            // Skip persisting empty assistant messages (error responses from provider)
            const isEmptyAssistant =
              message.role === "assistant" && message.content.length === 0;

            history.push(message);
            messagesAddedInRun++;

            if (!isEmptyAssistant) {
              messageStore.queuePersistMessage({
                accountId,
                conversationId,
                message,
                seq: nextSeq(accountId, conversationId),
              });
            }

            if (message.role === "assistant") {
              for (const block of message.content) {
                if (block.type === "toolCall") {
                  pendingToolArgs.set(block.id, block.arguments);
                }
              }
              return;
            }

            if (message.role === "toolResult") {
              log.tool(
                message.toolName,
                pendingToolArgs.get(message.toolCallId) ?? {},
                extractToolResultText(message),
              );
              pendingToolArgs.delete(message.toolCallId);
            }
          },
        },
        undefined,
        { model: chatModel.model, apiKey: chatModel.apiKey },
      );

      if (result.status !== "aborted") {
        log.done(accountId, rounds, Date.now() - startedAt);
      }

      switch (result.status) {
        case "completed": {
          const msg = result.finalMessage;
          const replyText = extractAssistantText(msg);

          // If the LLM returned an error or completely empty response, roll back
          if (!replyText && msg.stopReason !== "stop") {
            console.warn(
              `[chat] error response — rolling back ${messagesAddedInRun} message(s). ` +
                `stopReason: ${msg.stopReason} | errorMessage: ${(msg as any).errorMessage ?? "(none)"}`,
            );
            await rollbackMessages(accountId, conversationId, messagesAddedInRun);
          } else {
            // Tape: fire-and-forget LLM-based memory extraction
            // Resolve extraction model (may differ from chat model for cost savings)
            resolveModel(accountId, conversationId, "extraction")
              .then((extractionModel) => {
                fireExtractAndRecord(
                  extractionModel.model,
                  accountId,
                  conversationId,
                  { userText: text, assistantText: replyText },
                  `agent:${extractionModel.modelId}`,
                  extractionModel.apiKey,
                );
              })
              .catch((err) => console.warn("[chat] extraction model resolve failed:", err));

            // Compact if threshold reached
            withSpan("tape.compact", { branch: conversationId }, () =>
              compactIfNeeded(accountId, conversationId),
            ).catch((err) => console.warn("[tape] compact failed:", err));
          }

          return finalizeReply(replyText, "抱歉，出了点问题，请稍后再试。", {
            accountId,
            conversationId,
            startedAt,
            rounds,
          });
        }
        case "max_rounds":
          return finalizeReply(
            extractAssistantText(result.lastMessage),
            "抱歉，这次问题我还没处理完。",
            { accountId, conversationId, startedAt, rounds },
          );
        case "aborted":
          return { text: "请求已取消。" };
      }
    },
  );
}
