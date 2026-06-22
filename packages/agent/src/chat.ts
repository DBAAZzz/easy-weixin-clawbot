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
import {
  MESSAGE_CONTENT_TYPE,
  MESSAGE_ROLE,
  MESSAGE_STOP_REASON,
} from "@clawbot/shared";
import { withSpan } from "@clawbot/observability";
import type { AgentRunner, RunCallbacks, RunResult } from "./runner.js";
import {
  resolveConfiguredModel,
  resolveModel,
  type ResolvedModel,
} from "./model-resolver.js";
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
  GLOBAL_BRANCH,
} from "./tape/index.js";
import { extractMediaFromText } from "./media.js";
import { assembleUserContext } from "./prompts/assembler.js";
import { PROMPT_PROFILES } from "./prompts/profiles.js";
import { prepareUserVisualContent } from "./vision.js";
import {
  extractAssistantText,
  extractToolResultText,
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

/**
 * Load message history and tape memory (session + global) in parallel, returning
 * the live history array and the formatted memory block for prompt injection.
 */
async function loadConversationContext(
  accountId: string,
  conversationId: string,
): Promise<{ history: AgentMessage[]; memoryContext: string }> {
  const [, [sessionMemory, globalMemory]] = await Promise.all([
    withSpan("history.load", { conversationId, accountId }, () =>
      ensureHistoryLoaded(accountId, conversationId),
    ),
    withSpan("tape.recall", { conversationId, accountId }, () =>
      Promise.all([
        recall(accountId, conversationId),
        recall(accountId, GLOBAL_BRANCH),
      ]).catch((err) => {
        console.warn("[tape] recall failed, proceeding without memory:", err);
        return [emptyState(), emptyState()] as const;
      }),
    ),
  ]);

  return {
    history: getHistory(accountId, conversationId),
    memoryContext: formatMemoryForPrompt(globalMemory, sessionMemory),
  };
}

/**
 * Assemble the user message: prompt-profile text plus any prepared image content.
 */
async function buildUserMessage(params: {
  text: string;
  media: ChatMedia | undefined;
  memoryContext: string;
  chatModel: ResolvedModel;
  accountId: string;
  conversationId: string;
}): Promise<AgentMessage> {
  const { text, media, memoryContext, chatModel, accountId, conversationId } = params;

  const assembledText = assembleUserContext(PROMPT_PROFILES.chat, {
    tapeMemory: memoryContext || undefined,
    time: new Date(),
    userText: text || "(no text)",
  });

  const userContent: (TextContent | ImageContent)[] = [
    { type: MESSAGE_CONTENT_TYPE.TEXT, text: assembledText },
  ];
  const visualContexts: VisualContext[] = [];

  if (media?.type === "image") {
    const prepared = await prepareUserVisualContent({
      media,
      chatModel,
      accountId,
      conversationId,
    });
    userContent.push(...prepared.content);
    visualContexts.push(...prepared.visualContexts);
  }

  return {
    role: MESSAGE_ROLE.USER,
    content: userContent,
    timestamp: Date.now(),
    ...(visualContexts.length > 0 ? { visualContext: visualContexts } : {}),
  };
}

/** Append a message to live history and queue it for persistence. */
function appendMessage(accountId: string, conversationId: string, history: AgentMessage[], message: AgentMessage): void {
  history.push(message);
  getMessageStore().queuePersistMessage({
    accountId,
    conversationId,
    message,
    seq: nextSeq(accountId, conversationId),
  });
}

interface RunTracker {
  callbacks: RunCallbacks;
  /** Mutable counters read after the run completes. */
  state: { rounds: number; messagesAddedInRun: number };
}

/**
 * Consume the runner's message stream: append each message to history, persist
 * non-empty ones, log tool calls, and track round/message counters.
 */
function createMessageTracker(
  accountId: string,
  conversationId: string,
  history: AgentMessage[],
  log: ChatDeps["log"],
): RunTracker {
  const messageStore = getMessageStore();
  const pendingToolArgs = new Map<string, Record<string, unknown>>();
  const state = { rounds: 0, messagesAddedInRun: 0 };

  const callbacks: RunCallbacks = {
    onRoundStart(round) {
      state.rounds = round;
      log.llm(accountId, round);
    },

    onMessage(message: AgentMessage) {
      // Skip persisting empty assistant messages (error responses from provider)
      const isEmptyAssistant = isEmptyAssistantMessage(message);

      history.push(message);
      state.messagesAddedInRun++;

      if (!isEmptyAssistant) {
        messageStore.queuePersistMessage({
          accountId,
          conversationId,
          message,
          seq: nextSeq(accountId, conversationId),
        });
      }

      if (message.role === MESSAGE_ROLE.ASSISTANT) {
        for (const block of message.content) {
          if (block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL) {
            pendingToolArgs.set(block.id, block.arguments);
          }
        }
        return;
      }

      if (message.role === MESSAGE_ROLE.TOOL_RESULT) {
        log.tool(
          message.toolName,
          pendingToolArgs.get(message.toolCallId) ?? {},
          extractToolResultText(message),
        );
        pendingToolArgs.delete(message.toolCallId);
      }
    },
  };

  return { callbacks, state };
}

/**
 * Fire-and-forget LLM-based memory extraction. Resolves the extraction model
 * (falling back to the chat model) and records the turn — must not block the
 * user-facing response path.
 */
function scheduleMemoryExtraction(params: {
  accountId: string;
  conversationId: string;
  userText: string;
  assistantText: string;
  chatModel: ResolvedModel;
}): void {
  const { accountId, conversationId, userText, assistantText, chatModel } = params;

  void resolveConfiguredModel(accountId, conversationId, "extraction")
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
        { userText, assistantText },
        `agent:${effectiveExtractionModel.modelId}`,
      );
    })
    .catch((err) => console.warn("[chat] extraction model resolve failed:", err));
}

/**
 * Turn a runner RunResult into the user-facing reply, handling rollback of error
 * responses and firing post-response memory extraction / compaction.
 */
async function handleRunResult(params: {
  result: RunResult;
  accountId: string;
  conversationId: string;
  userText: string;
  chatModel: ResolvedModel;
  startedAt: number;
  rounds: number;
  messagesAddedInRun: number;
}): Promise<ChatResponse> {
  const { result, accountId, conversationId, userText, chatModel, startedAt, rounds, messagesAddedInRun } = params;
  const debug = { accountId, conversationId, startedAt, rounds };

  switch (result.status) {
    case "completed": {
      const msg = result.finalMessage;
      const replyText = extractAssistantText(msg);

      // If the LLM returned an error or completely empty response, roll back
      if (!replyText && msg.stopReason !== MESSAGE_STOP_REASON.STOP) {
        console.warn(
          `[chat] error response — rolling back ${messagesAddedInRun} message(s). ` +
            `stopReason: ${msg.stopReason} | errorMessage: ${(msg as any).errorMessage ?? "(none)"}`,
        );
        await rollbackMessages(accountId, conversationId, messagesAddedInRun);
      } else {
        // Both run asynchronously *after* the finalizeReply() return below.
        scheduleMemoryExtraction({ accountId, conversationId, userText, assistantText: replyText, chatModel });

        // Compact if threshold reached
        withSpan("tape.compact", { branch: conversationId }, () =>
          compactIfNeeded(accountId, conversationId),
        ).catch((err) => console.warn("[tape] compact failed:", err));
      }

      return finalizeReply(replyText, "抱歉，出了点问题，请稍后再试。", debug);
    }
    case "max_rounds":
      return finalizeReply(
        extractAssistantText(result.lastMessage),
        "抱歉，这次问题我还没处理完。",
        debug,
      );
    case "aborted":
      return { text: "请求已取消。" };
  }
}

export async function chat(
  accountId: string,
  conversationId: string,
  text: string,
  media?: ChatMedia,
  startedAt = Date.now(),
): Promise<ChatResponse> {
  const { runner, log } = getDeps();

  // Resolve the chat model dynamically based on account/conversation context
  const chatModel = await resolveModel(accountId, conversationId, "chat");

  return withSpan(
    "agent.chat",
    { model: chatModel.modelId, hasMedia: Boolean(media) },
    async () => {
      const { history, memoryContext } = await loadConversationContext(accountId, conversationId);

      const userMessage = await buildUserMessage({
        text,
        media,
        memoryContext,
        chatModel,
        accountId,
        conversationId,
      });
      appendMessage(accountId, conversationId, history, userMessage);

      const tracker = createMessageTracker(accountId, conversationId, history, log);

      const result = await runner.run(history, tracker.callbacks, undefined, {
        model: chatModel.model,
        meta: chatModel.meta,
      });

      if (result.status !== "aborted") {
        log.done(accountId, tracker.state.rounds, Date.now() - startedAt);
      }

      return handleRunResult({
        result,
        accountId,
        conversationId,
        userText: text,
        chatModel,
        startedAt,
        rounds: tracker.state.rounds,
        messagesAddedInRun: tracker.state.messagesAddedInRun,
      });
    },
  );
}
