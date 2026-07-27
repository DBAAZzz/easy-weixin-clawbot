/**
 * A single chat turn — loads history + tape memory → builds user message →
 * runs LLM → persists → extracts memory. Called by ChatEngine.chat().
 */

import type {
  ImageContent,
  AgentMessage,
  TextContent,
  TriggerMeta,
  VisualContext,
} from "../llm/types.js";
import { randomUUID } from "node:crypto";
import {
  MESSAGE_CONTENT_TYPE,
  MESSAGE_ROLE,
  MESSAGE_STOP_REASON,
} from "@clawbot/shared";
import { withSpan, getTraceId } from "@clawbot/observability";
import type { AgentRunner, RunCallbacks, RunResult } from "./runner.js";
import { runLogger, type RunContext } from "./context.js";
import type { ConversationCache } from "./conversation/cache.js";
import {
  resolveConfiguredModel,
  resolveModel,
  type ResolvedModel,
} from "../llm/model-resolver.js";
import type { ChatResponse, ChatMedia } from "../shared/types.js";
import type { DebugFlags } from "../commands/debug.js";
import { getMessageStore } from "../ports/message-store.js";
import { getUsageStore } from "../ports/usage-store.js";
import {
  emptyState,
  recall,
  compactIfNeeded,
  formatMemoryForPrompt,
  fireExtractAndRecord,
  GLOBAL_BRANCH,
} from "../memory/index.js";
import { extractMediaFromText } from "../shared/media.js";
import { assembleUserContext } from "../prompts/assembler.js";
import { PROMPT_PROFILES } from "../prompts/profiles.js";
import { prepareUserVisualContent } from "../llm/vision.js";
import {
  extractAssistantText,
  extractToolResultText,
  isEmptyAssistantMessage,
} from "../shared/utils/chat-utils.js";

export interface ChatLog {
  llm(accountId: string, round: number): void;
  tool(name: string, args: Record<string, unknown>, result: string): void;
  done(accountId: string, rounds: number, ms: number): void;
}

export interface ChatTurnDeps {
  runner: AgentRunner;
  log: ChatLog;
  cache: ConversationCache;
  debugFlags: DebugFlags;
}

export interface ChatTurnInput {
  text: string;
  media?: ChatMedia;
  startedAt?: number;
  /** Role under which `text` is recorded. Defaults to "user". */
  inputRole?: "user" | "trigger";
  /** Required when inputRole is "trigger". */
  triggerMeta?: TriggerMeta;
}

function finalizeReply(
  debugFlags: DebugFlags,
  text: string,
  fallback: string,
  debug?: { ctx: RunContext; startedAt: number; rounds: number },
): ChatResponse {
  const raw = text || fallback;
  const { cleanText, media } = extractMediaFromText(raw);

  let finalText = cleanText || undefined;
  if (finalText && debug && debugFlags.isEnabled(debug.ctx.accountId, debug.ctx.conversationId)) {
    const elapsed = Date.now() - debug.startedAt;
    finalText += `\n\n---\n⏱ ${debug.rounds} round(s), ${elapsed}ms`;
  }

  const response: ChatResponse = { text: finalText };
  if (media) response.media = media;
  return response;
}

function createUsageRequestId(): string {
  const traceId = getTraceId();
  return traceId === "no-trace" ? `chat:${randomUUID()}` : traceId;
}

/**
 * Load message history and tape memory (session + global) in parallel, returning
 * the live history array and the formatted memory block for prompt injection.
 */
async function loadConversationContext(
  cache: ConversationCache,
  ctx: RunContext,
): Promise<{ history: AgentMessage[]; memoryContext: string }> {
  const [, [sessionMemory, globalMemory]] = await Promise.all([
    withSpan("history.load", { conversationId: ctx.conversationId, accountId: ctx.accountId }, () =>
      cache.ensureLoaded(ctx.accountId, ctx.conversationId),
    ),
    withSpan("tape.recall", { conversationId: ctx.conversationId, accountId: ctx.accountId }, () =>
      Promise.all([
        recall(ctx.accountId, ctx.conversationId),
        recall(ctx.accountId, GLOBAL_BRANCH),
      ]).catch((err) => {
        runLogger(ctx).warn("tape recall failed, proceeding without memory", { err });
        return [emptyState(), emptyState()] as const;
      }),
    ),
  ]);

  return {
    history: cache.get(ctx.accountId, ctx.conversationId),
    memoryContext: formatMemoryForPrompt(globalMemory, sessionMemory),
  };
}

/**
 * Assemble the user message: prompt-profile text plus any prepared image content.
 */
async function buildUserMessage(
  ctx: RunContext,
  params: {
    text: string;
    media: ChatMedia | undefined;
    memoryContext: string;
    chatModel: ResolvedModel;
    inputRole?: "user" | "trigger";
    triggerMeta?: TriggerMeta;
  },
): Promise<AgentMessage> {
  const { text, media, memoryContext, chatModel, inputRole, triggerMeta } = params;

  const assembledText = assembleUserContext(PROMPT_PROFILES.chat, {
    tapeMemory: memoryContext || undefined,
    time: new Date(),
    userText: text || "(no text)",
  });

  // System-originated turns carry no media and are recorded under their own
  // role so history shows why the agent spoke unprompted.
  if (inputRole === "trigger") {
    if (!triggerMeta) {
      throw new Error("buildUserMessage: inputRole 'trigger' requires triggerMeta");
    }
    return {
      role: MESSAGE_ROLE.TRIGGER,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: assembledText }],
      timestamp: Date.now(),
      meta: triggerMeta,
    };
  }

  const userContent: (TextContent | ImageContent)[] = [
    { type: MESSAGE_CONTENT_TYPE.TEXT, text: assembledText },
  ];
  const visualContexts: VisualContext[] = [];

  if (media?.type === "image") {
    const prepared = await prepareUserVisualContent({
      media,
      chatModel,
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
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
function appendMessage(
  cache: ConversationCache,
  ctx: RunContext,
  history: AgentMessage[],
  message: AgentMessage,
): void {
  history.push(message);
  getMessageStore().queuePersistMessage({
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    message,
    seq: cache.nextSeq(ctx.accountId, ctx.conversationId),
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
  cache: ConversationCache,
  ctx: RunContext,
  history: AgentMessage[],
  log: ChatLog,
  usageRequestId: string,
): RunTracker {
  const { accountId, conversationId } = ctx;
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
          seq: cache.nextSeq(accountId, conversationId),
        });
      }

      if (message.role === MESSAGE_ROLE.ASSISTANT) {
        if (!isEmptyAssistant && message.usage) {
          getUsageStore().queueRecord({
            accountId,
            conversationId,
            requestId: usageRequestId,
            model: message.model ?? "unknown",
            provider: message.provider,
            inputTokens: message.usage.input,
            outputTokens: message.usage.output,
          });
        }
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
function scheduleMemoryExtraction(
  ctx: RunContext,
  params: { userText: string; assistantText: string; chatModel: ResolvedModel },
): void {
  const { userText, assistantText, chatModel } = params;
  const { accountId, conversationId } = ctx;
  const logger = runLogger(ctx);

  void resolveConfiguredModel(accountId, conversationId, "extraction")
    .then((extractionModel) => {
      const effectiveExtractionModel = extractionModel ?? chatModel;
      logger.info("tape extraction model resolved", {
        source: extractionModel ? "configured-extraction" : "chat-fallback",
        model: effectiveExtractionModel.modelId,
      });
      fireExtractAndRecord(
        effectiveExtractionModel.model,
        accountId,
        conversationId,
        { userText, assistantText },
        `agent:${effectiveExtractionModel.modelId}`,
      );
    })
    .catch((err) => logger.warn("extraction model resolve failed", { err }));
}

/**
 * Turn a runner RunResult into the user-facing reply, handling rollback of error
 * responses and firing post-response memory extraction / compaction.
 */
async function handleRunResult(
  ctx: RunContext,
  params: {
    cache: ConversationCache;
    debugFlags: DebugFlags;
    result: RunResult;
    userText: string;
    chatModel: ResolvedModel;
    startedAt: number;
    rounds: number;
    messagesAddedInRun: number;
  },
): Promise<ChatResponse> {
  const { cache, debugFlags, result, userText, chatModel, startedAt, rounds, messagesAddedInRun } =
    params;
  const { accountId, conversationId } = ctx;
  const debug = { ctx, startedAt, rounds };

  switch (result.status) {
    case "completed": {
      const msg = result.finalMessage;
      const replyText = extractAssistantText(msg);

      // If the LLM returned an error or completely empty response, roll back
      if (!replyText && msg.stopReason !== MESSAGE_STOP_REASON.STOP) {
        runLogger(ctx).warn("error response — rolling back turn", {
          rolledBackMessages: messagesAddedInRun,
          stopReason: msg.stopReason,
          errorMessage: msg.errorMessage,
        });
        await cache.rollback(accountId, conversationId, messagesAddedInRun);
      } else {
        // Both run asynchronously *after* the finalizeReply() return below.
        scheduleMemoryExtraction(ctx, { userText, assistantText: replyText, chatModel });

        // Compact if threshold reached
        withSpan("tape.compact", { branch: conversationId }, () =>
          compactIfNeeded(accountId, conversationId),
        ).catch((err) => runLogger(ctx).warn("tape compact failed", { err }));
      }

      return finalizeReply(debugFlags, replyText, "抱歉，出了点问题，请稍后再试。", debug);
    }
    case "max_rounds":
      return finalizeReply(
        debugFlags,
        extractAssistantText(result.lastMessage),
        "抱歉，这次问题我还没处理完。",
        debug,
      );
    case "aborted":
      return { text: "请求已取消。" };
  }
}

export async function runChatTurn(
  deps: ChatTurnDeps,
  ctx: RunContext,
  input: ChatTurnInput,
): Promise<ChatResponse> {
  const { runner, log, cache, debugFlags } = deps;
  const startedAt = input.startedAt ?? Date.now();

  // A turn mutates the shared in-memory history (append, and rollback on error),
  // so the caller must already hold this conversation's lock. The lock stays
  // outside because callers routinely need it to span more than one turn — and
  // because `withLock` is not reentrant, taking it here as well would deadlock.
  // Hence a guard rather than an acquisition.
  if (!cache.isLocked(ctx.accountId, ctx.conversationId)) {
    throw new Error(
      `runChatTurn called without holding the conversation lock for ` +
        `${ctx.accountId}/${ctx.conversationId} — wrap the call in ` +
        `ChatEngine.conversations.withLock().`,
    );
  }

  // Resolve the chat model dynamically based on account/conversation context
  const chatModel = await resolveModel(ctx.accountId, ctx.conversationId, "chat");

  return withSpan(
    "agent.chat",
    { model: chatModel.modelId, hasMedia: Boolean(input.media) },
    async () => {
      const { history, memoryContext } = await loadConversationContext(cache, ctx);

      const userMessage = await buildUserMessage(ctx, {
        text: input.text,
        media: input.media,
        memoryContext,
        chatModel,
        inputRole: input.inputRole,
        triggerMeta: input.triggerMeta,
      });
      appendMessage(cache, ctx, history, userMessage);

      const tracker = createMessageTracker(cache, ctx, history, log, createUsageRequestId());

      const result = await runner.run(
        history,
        tracker.callbacks,
        ctx.signal,
        {
          model: chatModel.model,
          meta: chatModel.meta,
        },
        ctx,
      );

      if (result.status !== "aborted") {
        log.done(ctx.accountId, tracker.state.rounds, Date.now() - startedAt);
      }

      return handleRunResult(ctx, {
        cache,
        debugFlags,
        result,
        userText: input.text,
        chatModel,
        startedAt,
        rounds: tracker.state.rounds,
        messagesAddedInRun: tracker.state.messagesAddedInRun,
      });
    },
  );
}
