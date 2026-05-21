/**
 * chat() — core conversation orchestration.
 *
 * Loads history + tape memory → builds user message → runs LLM → persists → extracts memory.
 * Decoupled from transport layer — no HTTP, no WeChat, no Prisma.
 */

import type {
  ImageContent,
  AgentMessage,
  TextContent,
  VisualContext,
} from "./llm/types.js";
import { withSpan } from "@clawbot/observability";
import { readFileSync } from "node:fs";
import type { AgentRunner } from "./runner.js";
import { resolveConfiguredModel, resolveModel } from "./model-resolver.js";
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
import { assembleUserContext } from "./prompts/assembler.js";
import { PROMPT_PROFILES } from "./prompts/profiles.js";
import { modelSupportsVision } from "./llm/model-meta.js";
import {
  createImagePlaceholder,
  describeImageWithVisionModel,
  formatVisualContextForPrompt,
} from "./vision.js";
import {
  detectImageMime,
  extractAssistantText,
  extractToolResultText,
  getChatModelVisionFallbackReason,
  getVisionFailureReason,
  isEmptyAssistantMessage,
} from "./utils/chat-utils.js";

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

      const assembledText = assembleUserContext(PROMPT_PROFILES.chat, {
        tapeMemory: memoryContext || undefined,
        time: new Date(),
        userText: text || "(no text)",
      });

      const userContent: (TextContent | ImageContent)[] = [
        { type: "text", text: assembledText },
      ];
      const visualContexts: VisualContext[] = [];
      let imagePromptReplacementText: string | undefined;

      if (media?.type === "image") {
        const buf = readFileSync(media.filePath);
        const mimeType = detectImageMime(buf) ?? media.mimeType;
        const data = buf.toString("base64");
        if (mimeType !== media.mimeType) {
          console.log(`[chat] image mimeType corrected: ${media.mimeType} → ${mimeType}`);
        }

        if (!modelSupportsVision(chatModel.meta)) {
          const fallbackReason = getChatModelVisionFallbackReason(chatModel.meta);
          const visionModel = await resolveConfiguredModel(accountId, conversationId, "vision");
          if (visionModel) {
            if (!modelSupportsVision(visionModel.meta)) {
              userContent.push(createImagePlaceholder("no_vision_model_configured"));
              imagePromptReplacementText = "[图片原始文件已保存；vision 模型未声明支持图片输入。]";
              console.warn(
                `[vision] configured vision model does not support image input: ${visionModel.modelId}`,
              );
            } else {
              try {
                const visualContext = await describeImageWithVisionModel({
                  model: visionModel.model,
                  modelId: visionModel.modelId,
                  imageData: data,
                  mimeType,
                  imageBytes: buf.byteLength,
                  fallbackReason,
                });
                visualContexts.push(visualContext);
                userContent.push(formatVisualContextForPrompt(visualContext));
                imagePromptReplacementText = "[图片原始文件已保存；图片内容见上方 visual_context。]";
              } catch (error) {
                const reason = getVisionFailureReason(error);
                console.warn("[vision] describe image failed, using placeholder:", error);
                userContent.push(createImagePlaceholder(reason));
                imagePromptReplacementText = "[图片原始文件已保存；图片内容识别失败。]";
              }
            }
          } else {
            userContent.push(createImagePlaceholder("no_vision_model_configured"));
            imagePromptReplacementText = "[图片原始文件已保存；未配置 vision 模型。]";
            console.warn("[vision] no vision model configured; image will be replaced with placeholder");
          }
        }

        userContent.push({
          type: "image",
          data,
          mimeType: mimeType as ImageContent["mimeType"],
          ...(imagePromptReplacementText ? { promptReplacementText: imagePromptReplacementText } : {}),
        });
      }

      const userMessage: AgentMessage = {
        role: "user",
        content: userContent,
        timestamp: Date.now(),
        ...(visualContexts.length > 0 ? { visualContext: visualContexts } : {}),
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

          onMessage(message: AgentMessage) {
            // Skip persisting empty assistant messages (error responses from provider)
            const isEmptyAssistant = isEmptyAssistantMessage(message);

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
        { model: chatModel.model, meta: chatModel.meta },
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
            resolveConfiguredModel(accountId, conversationId, "extraction")
              .then((extractionModel) => {
                const effectiveExtractionModel = extractionModel ?? chatModel;
                const extractionSource = extractionModel ? "configured-extraction" : "chat-fallback";
                console.log(
                  `[tape] extraction model source=${extractionSource} model=${effectiveExtractionModel.modelId}`,
                );
                fireExtractAndRecord(
                  effectiveExtractionModel.model,
                  accountId,
                  conversationId,
                  { userText: text, assistantText: replyText },
                  `agent:${effectiveExtractionModel.modelId}`,
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
