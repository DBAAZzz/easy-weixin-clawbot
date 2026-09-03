/**
 * A single chat turn — loads history + tape memory → builds user message →
 * runs LLM → persists → extracts memory. Called by ChatEngine.chat().
 */

import type {
  ImageContent,
  AgentMessage,
  TextContent,
  TriggerMeta,
  UserMessage,
  VisualContext,
} from "../llm/types.js";
import { randomUUID } from "node:crypto";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE, MESSAGE_STOP_REASON } from "@clawbot/shared";
import { withSpan, getTraceId } from "@clawbot/observability";
import type { AgentRunner, RunCallbacks, RunResult } from "./runner.js";
import { runLogger, type RunContext } from "./context.js";
import type { ConversationCache } from "./conversation/cache.js";
import { resolveConfiguredModel, resolveModel, type ResolvedModel } from "../llm/model-resolver.js";
import type { ChatResponse, ChatMedia } from "../shared/types.js";
import type { DebugFlags } from "../commands/debug.js";
import { getMessageStore } from "../ports/message-store.js";
import { getUsageStore } from "../ports/usage-store.js";
import { getArtifactRevisionStore } from "../ports/artifact-revision-store.js";
import { projectionWriteModeFor } from "../ports/projection-write.js";
import type { ArtifactContentSink } from "../ports/artifact-content-sink.js";
import { compactIfNeeded, fireExtractAndRecord } from "../memory/index.js";
import { extractMediaFromText } from "../shared/media.js";
import { assembleUserContext } from "../prompts/assembler.js";
import { PROMPT_PROFILES } from "../prompts/profiles.js";
import { prepareUserVisualContent } from "../llm/vision.js";
import { modelSupportsVision } from "../llm/model-meta.js";
import {
  extractAssistantText,
  extractToolResultText,
  isEmptyAssistantMessage,
} from "../shared/utils/chat-utils.js";
import type {
  ContextShadowObserver,
  PendingContextShadowHandle,
} from "./context-shadow/observer.js";
import { ARTIFACT_KIND } from "../shared/fact-ledger/contracts.js";
import { putDocumentArtifact } from "./run-ledger/revisions.js";
import { getPromptAssets } from "../prompts/port.js";
import { createDeliveryId, toStableErrorCode } from "./run-ledger/ids.js";
import type { RunLedgerRecorder } from "./run-ledger/recorder.js";
import type { RunnerLedger } from "./runner.js";
import type { CompiledContextV1 } from "../context-compiler/types.js";
import {
  buildCanonicalHistory,
  CanonicalContextBuildError,
  compareDualHistories,
  loadLegacyContext,
  type ContextReadPath,
  type MemoryReadPath,
} from "./context-build/index.js";
import {
  contextDualDiffTotal,
  contextReadFallbackTotal,
  contextReadPathTotal,
  projectionWriteSkippedTotal,
  projectionWriteTotal,
} from "@clawbot/observability";

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
  /** Source fact for the user message persistence link; never enters model-visible content. */
  sourceConversationEventId?: string;
  /** Request-local clock captured once and shared with legacy and shadow compilation. */
  effectiveTime?: string;
  /**
   * Phase 6：上下文读取三态（design §8）。缺省 legacy。dual/canonical 需要
   * runLedger 依赖（编译闭包）；缺依赖时自动回落 legacy。
   */
  contextReadPath?: ContextReadPath;
  /**
   * Phase 7：记忆注入读取三态（design §7.3）。缺省 tape（Phase 0–6 行为）。
   * server 侧仅在 run ledger 启用时转发非 tape 值。
   */
  memoryReadPath?: MemoryReadPath;
  contextShadow?: {
    observer: ContextShadowObserver;
    sourceEventId: string;
    conversationStreamId: string;
    eventCursor: number;
  };
  /** Run Ledger wiring for ingress chat turns (Phase 4). Recorder is per-run. */
  runLedger?: {
    recorder: RunLedgerRecorder;
    /** Phase 5：接收 coverage hints 并透传给 compiler（hints 链路不可断）。 */
    compileContext: (hints: {
      coverageHints?: { memoryFacts?: boolean; immutableMediaArtifacts?: boolean };
    }) => Promise<CompiledContextV1>;
    conversationStreamId: string;
    /** Ingress run 的出处事件；trigger run（heartbeat/scheduler）缺省（Phase 6）。 */
    sourceEventId?: string;
    /** Phase 6：trigger run 发起时执行流的最后 streamSeq（run_started 排序锚点，§5.1）。 */
    anchorStreamSeq?: number;
    /** Phase 6：canonical 媒体重放读取 MEDIA_ASSET 字节的 sink（§7.3）。 */
    contentSink?: ArtifactContentSink;
  };
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

interface LoadedContext {
  history: AgentMessage[];
  memoryContext: string;
  /** canonical 覆写 cache 数组前的 legacy 视图快照（shadow 观察仍然对比 legacy）。 */
  legacyHistorySnapshot?: AgentMessage[];
}

/**
 * Read-path dispatch (Phase 6 design §8): legacy keeps the live cache array;
 * dual compares the parallel canonical build against it and keeps feeding
 * legacy; canonical overwrites the live cache array in place so appends,
 * persistence and rollback stay coherent. Memory injection always comes from
 * Tape recall (§1.7) — only history source switches.
 */
async function loadTurnContext(
  cache: ConversationCache,
  ctx: RunContext,
  input: ChatTurnInput,
  chatModel: ResolvedModel,
): Promise<LoadedContext> {
  const legacy = await loadLegacyContext(cache, ctx, {
    memoryReadPath: input.memoryReadPath,
  });
  const requested = input.contextReadPath ?? "legacy";
  const effective: ContextReadPath =
    requested !== "legacy" && input.runLedger ? requested : "legacy";
  contextReadPathTotal.inc({ account: ctx.accountId, path: effective });
  if (requested !== "legacy" && !input.runLedger) {
    contextReadFallbackTotal.inc({ reason: "ledger_missing" });
  }
  if (effective === "legacy") return legacy;

  try {
    const canonical = await buildCanonicalHistory({
      accountId: ctx.accountId,
      compileContext: input.runLedger!.compileContext,
      artifactRevisionStore: getArtifactRevisionStore(),
      contentSink: input.runLedger!.contentSink,
      supportsImageInput: modelSupportsVision(chatModel.meta),
    });

    if (effective === "dual") {
      const comparison = compareDualHistories(legacy.history, canonical.messages);
      contextDualDiffTotal.inc({
        result: comparison.result,
        dimension: comparison.result === "same" ? "none" : (comparison.dimensions[0] ?? "none"),
      });
      if (comparison.result === "different") {
        runLogger(ctx).warn("context dual diff", {
          dimensions: comparison.dimensions,
          firstDivergenceIndex: comparison.firstDivergenceIndex ?? -1,
          entryCount: legacy.history.length,
        });
      }
      return legacy;
    }

    // canonical：原位覆盖 cache 数组，append/rollback/persist 语义保持不变。
    const live = cache.get(ctx.accountId, ctx.conversationId);
    const legacyHistorySnapshot = [...live];
    live.length = 0;
    live.push(...canonical.messages);
    return { history: live, memoryContext: legacy.memoryContext, legacyHistorySnapshot };
  } catch (error) {
    // 读路径 fail-open 回 legacy：只影响当次组装（§8.3）。
    contextReadFallbackTotal.inc({
      reason:
        error instanceof CanonicalContextBuildError ? error.code : "build_failed",
    });
    runLogger(ctx).warn("canonical context build failed; falling back to legacy", { err: error });
    return legacy;
  }
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
    effectiveTime: string;
  },
): Promise<AgentMessage> {
  const { text, media, memoryContext, chatModel, inputRole, triggerMeta, effectiveTime } = params;

  const assembledText = assembleUserContext(PROMPT_PROFILES.chat, {
    tapeMemory: memoryContext || undefined,
    time: new Date(effectiveTime),
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

/**
 * Phase 7 (§6): projection-shaped variant of a user message for
 * `legacy_write_mode = clean`. The persisted projection carries the original
 * user text plus the image blocks (asset ids kept for UI display); the
 * assembled text, visual fallback placeholders and the visualContext sidecar
 * never reach `messages.payload`. The in-memory message keeps the assembled
 * form — legacy read paths need it.
 */
function buildCleanProjectionUserMessage(
  message: UserMessage,
  originalText: string,
): AgentMessage {
  const { visualContext: _dropped, ...base } = message;
  const content = Array.isArray(base.content) ? base.content : [];
  const imageBlocks = content
    .filter((block): block is ImageContent => block.type === MESSAGE_CONTENT_TYPE.IMAGE)
    .map(({ promptReplacementText: _stripped, ...block }) => block);
  return {
    ...base,
    content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: originalText }, ...imageBlocks],
  };
}

/**
 * Append a message to live history and queue it for persistence.
 *
 * Phase 7 (§6.2): the write mode gates only the *persisted projection* — the
 * live history array is untouched in every mode, so rollback/seq semantics
 * stay identical. `clean` persists the original user text for user messages;
 * `suspended` skips persistence entirely.
 */
function appendMessage(
  cache: ConversationCache,
  ctx: RunContext,
  history: AgentMessage[],
  message: AgentMessage,
  sourceConversationEventId?: string,
  originalText?: string,
): void {
  history.push(message);
  const mode = projectionWriteModeFor(ctx.accountId);
  projectionWriteTotal.inc({ mode });
  if (mode === "suspended") {
    projectionWriteSkippedTotal.inc({ reason: "suspended" });
    return;
  }
  let persistMessage = message;
  if (mode === "clean" && message.role === MESSAGE_ROLE.USER && originalText !== undefined) {
    try {
      persistMessage = buildCleanProjectionUserMessage(message, originalText);
    } catch (error) {
      // Projection-variant failure falls back to the existing payload rather
      // than dropping the row (§11).
      runLogger(ctx).warn("clean projection variant failed; persisting assembled form", {
        err: error,
      });
      persistMessage = message;
    }
  }
  getMessageStore().queuePersistMessage({
    accountId: ctx.accountId,
    conversationId: ctx.conversationId,
    message: persistMessage,
    seq: cache.nextSeq(ctx.accountId, ctx.conversationId),
    sourceConversationEventId,
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
        // Phase 7 (§6.2): `suspended` keeps the live history but stops the
        // messages projection writes; `clean` does not change the
        // assistant/tool payload shape.
        const writeMode = projectionWriteModeFor(accountId);
        if (writeMode === "suspended") {
          projectionWriteSkippedTotal.inc({ reason: "suspended" });
        } else {
          projectionWriteTotal.inc({ mode: writeMode });
          messageStore.queuePersistMessage({
            accountId,
            conversationId,
            message,
            seq: cache.nextSeq(accountId, conversationId),
          });
        }
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
  params: {
    userText: string;
    assistantText: string;
    chatModel: ResolvedModel;
    /** Phase 5：账本证据链（ingress turn 且账本启用时才有）。 */
    evidence?: { sourceEventId?: string; runId?: string };
  },
): void {
  const { userText, assistantText, chatModel, evidence } = params;
  const { accountId, conversationId } = ctx;
  const logger = runLogger(ctx);

  void resolveConfiguredModel(accountId, conversationId, "extraction")
    .then(async (extractionModel) => {
      const effectiveExtractionModel = extractionModel ?? chatModel;
      logger.info("tape extraction model resolved", {
        source: extractionModel ? "configured-extraction" : "chat-fallback",
        model: effectiveExtractionModel.modelId,
      });

      // Phase 5：固定 extractor 模型与 prompt 的 revision（证据链成对必填）。
      // 任一失败 → 证据链不完整 → fact-writer 放弃写事件，Tape 照常。
      let extractionModelRevisionId: string | undefined;
      let extractionPromptRevisionId: string | undefined;
      if (evidence?.sourceEventId && evidence.runId) {
        try {
          const modelRevision = await putDocumentArtifact(
            { artifactRevisionStore: getArtifactRevisionStore() },
            ARTIFACT_KIND.MODEL_CONFIG_REVISION,
            {
              modelId: effectiveExtractionModel.modelId,
              purpose: "extraction",
              contextWindow: effectiveExtractionModel.meta.contextWindow,
              maxOutputTokens: effectiveExtractionModel.meta.maxOutputTokens,
              supportsImageInput: effectiveExtractionModel.meta.supportsImageInput,
              requiresReasonedToolHistory: effectiveExtractionModel.meta.requiresReasonedToolHistory,
            },
          );
          const promptKey = PROMPT_PROFILES.memory_extract.systemPromptKey;
          const promptRevision = await putDocumentArtifact(
            { artifactRevisionStore: getArtifactRevisionStore() },
            ARTIFACT_KIND.PROMPT_REVISION,
            { key: promptKey, body: getPromptAssets().get(promptKey) },
          );
          extractionModelRevisionId = modelRevision.artifactId;
          extractionPromptRevisionId = promptRevision.artifactId;
        } catch (err) {
          logger.warn("extraction revision pin failed; ledger events skipped", { err });
        }
      }

      fireExtractAndRecord(
        effectiveExtractionModel.model,
        accountId,
        conversationId,
        { userText, assistantText },
        `agent:${effectiveExtractionModel.modelId}`,
        undefined,
        evidence?.sourceEventId && evidence.runId
          ? {
              sourceEventId: evidence.sourceEventId,
              runId: evidence.runId,
              extractionModelRevisionId,
              extractionPromptRevisionId,
            }
          : undefined,
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
    /** Phase 5：记忆账本证据链（ingress turn 才有）。 */
    memoryEvidence?: { sourceEventId?: string; runId?: string };
  },
): Promise<ChatResponse> {
  const {
    cache,
    debugFlags,
    result,
    userText,
    chatModel,
    startedAt,
    rounds,
    messagesAddedInRun,
    memoryEvidence,
  } = params;
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
        scheduleMemoryExtraction(ctx, {
          userText,
          assistantText: replyText,
          chatModel,
          evidence: memoryEvidence,
        });

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
  const effectiveTime = input.effectiveTime ?? new Date(startedAt).toISOString();

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
      const { history, memoryContext, legacyHistorySnapshot } = await loadTurnContext(
        cache,
        ctx,
        input,
        chatModel,
      );

      const userMessage = await buildUserMessage(ctx, {
        text: input.text,
        media: input.media,
        memoryContext,
        chatModel,
        inputRole: input.inputRole,
        triggerMeta: input.triggerMeta,
        effectiveTime,
      });
      appendMessage(
        cache,
        ctx,
        history,
        userMessage,
        input.sourceConversationEventId,
        input.inputRole === "trigger" ? undefined : input.text,
      );

      let shadowHandle: PendingContextShadowHandle | undefined;
      if (input.contextShadow) {
        try {
          shadowHandle = input.contextShadow.observer.start({
            sourceEventId: input.contextShadow.sourceEventId,
            accountId: ctx.accountId,
            conversationStreamId: input.contextShadow.conversationStreamId,
            eventCursor: input.contextShadow.eventCursor,
            effectiveTime,
            timezone: "Asia/Shanghai",
            compilerVersion: "context-compiler-v1",
            contextPolicyRevisionId: "context-policy-v2",
            legacyMessages: legacyHistorySnapshot ?? history,
          });
        } catch (error) {
          // The observer guards itself; this net keeps any throw from a
          // third-party start() from failing the production turn.
          runLogger(ctx).warn("context shadow start failed; continuing turn", { err: error });
        }
      }

      // Run Ledger (Phase 4): run_started is an inline queue write before the
      // runner starts; its failure degrades the run and the turn proceeds.
      // Phase 6：trigger run 无 sourceEventId（envelope causation 省略），
      // anchorStreamSeq 落 run_started payload（§5.1）。
      let runnerLedger: RunnerLedger | undefined;
      if (input.runLedger) {
        const { recorder } = input.runLedger;
        const started = await recorder.start({
          conversationStreamId: input.runLedger.conversationStreamId,
          sourceEventId: input.runLedger.sourceEventId,
          anchorStreamSeq: input.runLedger.anchorStreamSeq,
          occurredAt: new Date().toISOString(),
        });
        if (started && !recorder.isDegraded()) {
          // Phase 5：buildUserMessage 产出的视觉观察固化为 VISUAL_OBSERVATION
          // 制品（inline，小文档）；失败只损失 manifest 字段。
          const visualObservationIds: string[] = [];
          for (const visualContext of userMessage.role === MESSAGE_ROLE.USER
            ? (userMessage.visualContext ?? [])
            : []) {
            const artifact = await recorder.putArtifact(
              ARTIFACT_KIND.VISUAL_OBSERVATION,
              visualContext,
            );
            if (artifact) visualObservationIds.push(artifact.artifactId);
          }
          runnerLedger = {
            recorder,
            compileContext: input.runLedger.compileContext,
            effectiveTime,
            sessionBranch: ctx.conversationId,
            visualObservationIds,
          };
        }
      }

      const tracker = createMessageTracker(cache, ctx, history, log, createUsageRequestId());

      let result: RunResult;
      try {
        result = await runner.run(
          history,
          tracker.callbacks,
          ctx.signal,
          {
            model: chatModel.model,
            meta: chatModel.meta,
          },
          ctx,
          runnerLedger,
        );
      } catch (error) {
        shadowHandle?.discard("turn_failed");
        await input.runLedger?.recorder.finishInterrupted({ reason: toStableErrorCode(error) });
        throw error;
      }

      try {
        if (result.status !== "aborted") {
          log.done(ctx.accountId, tracker.state.rounds, Date.now() - startedAt);
        }

        const response = await handleRunResult(ctx, {
          cache,
          debugFlags,
          result,
          userText: input.text,
          chatModel,
          startedAt,
          rounds: tracker.state.rounds,
          messagesAddedInRun: tracker.state.messagesAddedInRun,
          // Phase 5：只有账本真正启动成功（runnerLedger 已建立）的 run 才能
          // 作为记忆证据链——degraded/未启动的 runId 会制造孤儿引用。
          memoryEvidence: {
            sourceEventId: input.sourceConversationEventId,
            runId: runnerLedger?.recorder.runId,
          },
        });
        const committed =
          result.status === "max_rounds" ||
          (result.status === "completed" &&
            (Boolean(extractAssistantText(result.finalMessage)) ||
              result.finalMessage.stopReason === MESSAGE_STOP_REASON.STOP));
        if (committed) void shadowHandle?.publish();
        else shadowHandle?.discard("turn_failed");

        if (input.runLedger) {
          const { recorder, sourceEventId } = input.runLedger;
          // Ingress: delivery keyed by the receipt; trigger runs (§5.2) key by
          // the runId itself — delivery-v1:<sha256(accountId + runId)>.
          const deliveryTargetId = sourceEventId ?? recorder.runId;
          if (committed) {
            // run_completed precedes delivery_requested in the queue (design §5.2).
            await recorder.finishCompleted({
              rounds: tracker.state.rounds,
              finalResponseArtifactId: recorder.getFinalResponseArtifactId(),
            });
            await recorder.recordDeliveryRequested({
              deliveryId: createDeliveryId(ctx.accountId, deliveryTargetId),
            });
          } else {
            // Design §5.3: aborted turns are their own reason — only a
            // completed-but-rolled-back turn is "turn_rolled_back".
            await recorder.finishInterrupted({
              reason: result.status === "aborted" ? "aborted" : "turn_rolled_back",
            });
          }
        }
        return response;
      } catch (error) {
        shadowHandle?.discard("turn_failed");
        await input.runLedger?.recorder.finishInterrupted({ reason: toStableErrorCode(error) });
        throw error;
      }
    },
  );
}
