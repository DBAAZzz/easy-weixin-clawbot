import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  contextCompilerShadowTotal,
  runLedgerTotal,
  getActiveTrace,
  runWithTrace,
  withSpan,
  withSpanSync,
} from "@clawbot/observability";
import type { Agent, ChatRequest, ChatResponse } from "@clawbot/weixin-agent-sdk";
import {
  CommandRegistry,
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V4,
  CONTEXT_TIMEZONE,
  createHandoffAnchors,
  createRunId,
  createRunLedgerRecorder,
  getAgentRunStore,
  getArtifactRevisionStore,
  isLLMProviderNotConfiguredError,
  notePulseActivity,
} from "@clawbot/agent";
import type { ChatMedia as AgentChatMedia, RunContext } from "@clawbot/agent";
import type { ContextShadowObserver, ConversationEvent } from "@clawbot/agent";
import { getPushService, getSchedulerStore } from "@clawbot/agent/ports";
import { chatEngine } from "./ai.js";
import { getAssetService } from "./assets/index.js";
import { recordAttachmentArtifactMapping } from "./db/conversation-attachment-artifacts.js";
import {
  createServerRunLedgerCompiler,
  factLedgerContentSink,
  runLedgerMetrics,
} from "./db/fact-ledger-runtime.js";
import {
  getConversationTitle,
  setConversationTitleIfEmpty,
  updateContextToken,
} from "./db/conversations.js";
import { deleteRoute, getRoute, upsertRoute } from "./db/session-routes.js";
import { createModuleLogger, getErrorFields, log } from "./logger.js";
import { observabilityService } from "./observability/service.js";
import { TTS_CACHE_DIR } from "./paths.js";
import { getTTSProvider } from "./services/tts/index.js";
import { clearIngressSession } from "./db/clear-ingress-session.js";

/**
 * Populated once at startup by index.ts — every command is registered there so
 * `/help` can never depend on which module happened to be imported first.
 */
export const commandRegistry = new CommandRegistry();

const agentLogger = createModuleLogger("agent");

async function detectImageMimeFromPath(filePath: string): Promise<string | undefined> {
  const header = await readFile(filePath).then((buf) => buf.subarray(0, 12));
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47
  ) {
    return "image/png";
  }
  if (header.length >= 6 && header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
    return "image/gif";
  }
  if (
    header.length >= 12 &&
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

async function attachAssetIdToMedia(
  accountId: string,
  conversationId: string,
  media: ChatRequest["media"],
  /** Phase 5：媒体消息的 attachment source ref（ingress 媒体才有）。 */
  sourceRef?: string,
): Promise<AgentChatMedia | undefined> {
  if (!media) return undefined;
  const mimeType =
    media.type === "image"
      ? ((await detectImageMimeFromPath(media.filePath)) ?? media.mimeType)
      : media.mimeType;
  const asset = await getAssetService().createFromFile({
    accountId,
    conversationId,
    sourcePath: media.filePath,
    mimeType,
    kind: media.type,
    originalFilename: media.fileName,
  });

  // Phase 5：媒体制品化 + source ref 映射（设计 §7.1）。文件字节内容寻址，
  // 字节经 content sink 外置；失败只损失 resolved 能力（回落 unresolved），
  // 不影响资产创建与消息处理。
  if (sourceRef) {
    try {
      const fileBytes = new Uint8Array(await readFile(media.filePath));
      const fileSha256 = createHash("sha256").update(fileBytes).digest("hex");
      const artifactId = `media-asset-v1:${fileSha256}`;
      const storageRef = await factLedgerContentSink.put(
        `media_asset/${fileSha256}.bin`,
        fileBytes,
      );
      await getArtifactRevisionStore().put({
        artifactId,
        kind: "media_asset",
        sha256: fileSha256,
        schemaVersion: 1,
        storageRef,
      });
      await recordAttachmentArtifactMapping({
        accountId,
        sourceRef,
        artifactId,
        mimeType,
      });
    } catch (err) {
      agentLogger.warn(
        { ...getErrorFields(err), accountId, conversationId },
        "media artifact mapping failed; attachment stays unresolved",
      );
    }
  }

  return {
    ...media,
    mimeType,
    assetId: asset.id,
  };
}

/**
 * In-memory cache of wechatConvId → effectiveConvId per account.
 * Key: `${accountId}::${wechatConvId}`
 */
const sessionCache = new Map<string, string>();

async function getEffectiveConvId(accountId: string, wechatConvId: string): Promise<string> {
  const k = `${accountId}::${wechatConvId}`;
  if (sessionCache.has(k)) return sessionCache.get(k)!;

  const persisted = await getRoute(accountId, wechatConvId);
  const effective = persisted ?? wechatConvId;
  sessionCache.set(k, effective);
  return effective;
}

async function rotateSession(accountId: string, wechatConvId: string): Promise<string> {
  const k = `${accountId}::${wechatConvId}`;
  const oldEffective = sessionCache.get(k) ?? wechatConvId;
  const newEffective = `${wechatConvId}#${Date.now()}`;

  // Create handoff anchors to bridge old → new branch memories
  try {
    await createHandoffAnchors(accountId, oldEffective, newEffective);
  } catch (err) {
    agentLogger.warn(
      {
        ...getErrorFields(err),
        accountId,
        oldConversationId: oldEffective,
        newConversationId: newEffective,
      },
      "创建会话交接锚点失败",
    );
  }

  chatEngine.conversations.evict(accountId, oldEffective);
  sessionCache.set(k, newEffective);
  await upsertRoute(accountId, wechatConvId, newEffective);
  return newEffective;
}

mkdirSync(TTS_CACHE_DIR, { recursive: true });

/**
 * Synthesize reply text to an audio file and return its path.
 */
async function synthesizeReply(text: string): Promise<string | undefined> {
  try {
    const tts = getTTSProvider();
    const result = await tts.synthesize(text);
    const fileName = `tts-${Date.now()}.${result.format}`;
    const filePath = join(TTS_CACHE_DIR, fileName);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, result.audio);
    agentLogger.info(
      {
        bytes: result.audio.length,
        durationSeconds: result.duration ?? null,
        filePath,
      },
      "已生成 TTS 回复音频",
    );
    return filePath;
  } catch (err) {
    agentLogger.error({ ...getErrorFields(err) }, "TTS 合成失败，将回退为纯文本回复");
    return undefined;
  }
}

/**
 * Deliver any scheduler task results that couldn't be pushed.
 */
async function deliverUnpushedRuns(accountId: string, conversationId: string): Promise<void> {
  const store = getSchedulerStore();
  const runs = await store.findUnpushedRuns(accountId, conversationId);
  if (runs.length === 0) return;

  for (const run of runs) {
    if (!run.result) continue;
    try {
      const header = `📬 [定时任务 #${run.task.seq}「${run.task.name}」补发结果]\n`;
      await getPushService().sendProactiveMessage(accountId, conversationId, header + run.result);
      await store.markRunPushed(run.id);
    } catch (err) {
      agentLogger.warn(
        {
          ...getErrorFields(err),
          accountId,
          conversationId,
          runId: run.id,
        },
        "补发未推送的定时任务结果失败",
      );
      break;
    }
  }
}

async function generateTitleIfNeeded(
  accountId: string,
  conversationId: string,
  turn: { userText: string; assistantText: string },
): Promise<void> {
  const existingTitle = await getConversationTitle(accountId, conversationId);
  if (existingTitle?.trim() && existingTitle.trim() !== "未命名会话") {
    return;
  }

  const title = await chatEngine.generateConversationTitle(
    { accountId, conversationId, runKind: "chat" },
    turn,
  );
  if (!title) {
    return;
  }

  await setConversationTitleIfEmpty(accountId, conversationId, title);
}

export interface ServerWeixinAgent extends Agent {
  chatFromIngress(
    req: ChatRequest,
    source: Pick<
      ConversationEvent,
      "eventId" | "streamId" | "streamSeq" | "eventType" | "payload"
    >,
  ): Promise<ChatResponse>;
  clearFromIngress(receiptId: string, wechatConversationId: string): Promise<void>;
}

/** Create an Agent bound to a specific WeChat account. */
export function createAgent(
  accountId: string,
  options: {
    contextShadowObserver?: ContextShadowObserver;
    /** Startup snapshot from RunLedgerRolloutStore (Phase 4). */
    runLedgerEnabled?: boolean;
    /** Phase 6：startup snapshot of read_path（rollout 关闭时无意义）。 */
    contextReadPath?: "legacy" | "dual" | "canonical";
    /**
     * Phase 7：startup snapshot of memory_read_path（rollout 关闭时无意义；
     * clean/suspended 写模式经 projection-write resolver 全局生效，不经此处）。
     */
    memoryReadPath?: "tape" | "dual" | "events";
  } = {},
): ServerWeixinAgent {
  const runLedgerCompiler = createServerRunLedgerCompiler();

  async function chat(
    req: ChatRequest,
    source?: Pick<
      ConversationEvent,
      "eventId" | "streamId" | "streamSeq" | "eventType" | "payload"
    >,
  ): Promise<ChatResponse> {
    let shadowStarted = false;
    const trackedShadowObserver = options.contextShadowObserver
      ? ({
          start(input: Parameters<ContextShadowObserver["start"]>[0]) {
            shadowStarted = true;
            return options.contextShadowObserver!.start(input);
          },
          skipTurnFailed() {
            options.contextShadowObserver!.skipTurnFailed();
          },
          drain() {
            return options.contextShadowObserver!.drain();
          },
        } satisfies ContextShadowObserver)
      : undefined;
    log.recv(accountId, req.conversationId, req.text, req.media?.type);
    // Save contextToken to database for proactive push
    if (req.contextToken) {
      void updateContextToken(accountId, req.conversationId, req.contextToken).catch((err) => {
        log.error(`updateContextToken(${accountId}/${req.conversationId})`, err);
      });

      void deliverUnpushedRuns(accountId, req.conversationId).catch((err) => {
        log.error(`deliverUnpushedRuns(${accountId}/${req.conversationId})`, err);
      });
    }

    const startedAt = Date.now();
    // Request-local clock captured once and shared by legacy path, shadow and
    // run-ledger compilation (Phase 4 design §2).
    const effectiveTime = new Date(startedAt).toISOString();
    const effectiveConvId = await getEffectiveConvId(accountId, req.conversationId);

    return runWithTrace(accountId, effectiveConvId, async () => {
      try {
        withSpanSync(
          "message.receive",
          {
            hasMedia: Boolean(req.media),
            textLength: req.text.length,
            promptSnapshot: req.text,
          },
          () => undefined,
        );

        // 内置命令拦截（不经过 LLM）
        const dispatched = withSpanSync(
          "command.dispatch",
          { textLength: req.text.length },
          (span) => {
            const result = commandRegistry.tryDispatch(req.text);
            span.addAttributes({
              matched: Boolean(result),
              commandName: result?.command.name ?? "none",
            });
            return result;
          },
        );

        if (dispatched) {
          const reply = await withSpan(
            "command.execute",
            { commandName: dispatched.command.name },
            async () =>
              dispatched.command.execute({
                accountId,
                conversationId: effectiveConvId,
                args: dispatched.args,
                startedAt,
                commands: commandRegistry.list(),
                rotateSession: () =>
                  rotateSession(accountId, req.conversationId).then(() => undefined),
              }),
          );

          return withSpanSync(
            "message.send",
            {
              hasText: Boolean(reply.text),
              hasMedia: Boolean(reply.media),
              completionSnapshot: reply.text ?? "",
            },
            () => {
              log.send(accountId, req.conversationId, reply.text ?? "");
              return reply;
            },
          );
        }

        // Pick 会破坏判别联合的窄化，这里显式取 inbound 媒体的第一个 ref
        const sourceRefForMedia =
          source?.eventType === "inbound_message_received"
            ? (source.payload as { attachmentRefs?: string[] }).attachmentRefs?.[0]
            : undefined;
        const media = await withSpan("asset.ingest", { hasMedia: Boolean(req.media) }, () =>
          attachAssetIdToMedia(
            accountId,
            effectiveConvId,
            req.media,
            // Phase 5：只有 ingress 媒体消息才有 source ref 可映射
            sourceRefForMedia,
          ),
        );
        const ctx: RunContext = {
          accountId,
          conversationId: effectiveConvId,
          targetConversationId: req.conversationId,
          runKind: "chat",
        };
        // Phase 3 shadow covers only ingress chats; count disabled turns here so
        // the metric stays turn-level comparable with enabled accounts.
        if (source && !trackedShadowObserver) {
          contextCompilerShadowTotal.inc({ result: "disabled" });
        }
        // Phase 4 Run Ledger: per-turn recorder, gated by the startup rollout
        // snapshot. Disabled turns are counted so the metric stays turn-level.
        const runLedgerInput =
          source && options.runLedgerEnabled
            ? {
                recorder: createRunLedgerRecorder({
                  agentRunStore: getAgentRunStore(),
                  artifactRevisionStore: getArtifactRevisionStore(),
                  contentSink: factLedgerContentSink,
                  accountId,
                  runId: createRunId(accountId, source.eventId),
                  metrics: runLedgerMetrics,
                  onError(fields) {
                    agentLogger.warn({ ...fields, accountId }, "run ledger degraded");
                  },
                }),
                compileContext: (hints: {
                  coverageHints?: {
                    memoryFacts?: boolean;
                    immutableMediaArtifacts?: boolean;
                  };
                }) =>
                  runLedgerCompiler.compile({
                    accountId,
                    conversationStreamId: source.streamId,
                    eventCursor: source.streamSeq,
                    compilerVersion: CONTEXT_COMPILER_VERSION,
                    // Phase 6：run-ledger 编译统一 v3；Phase 7 切 v4 = v3 +
                    // legacy transcript entries（未导入的流与 v3 逐字节同输出；
                    // v2/v3 保留为回归锚与 shadow 口径）。
                    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V4,
                    effectiveTime,
                    timezone: CONTEXT_TIMEZONE,
                    // Phase 5：hints 一路透传，coverage 与 manifest 保持一致
                    ...(hints.coverageHints
                      ? { coverageHints: hints.coverageHints }
                      : {}),
                  }),
                conversationStreamId: source.streamId,
                sourceEventId: source.eventId,
              }
            : undefined;
        if (source && !options.runLedgerEnabled) {
          runLedgerTotal.inc({ result: "disabled" });
        }
        const reply = await withSpan("conversation.lock", {}, async () =>
          chatEngine.conversations.withLock(accountId, effectiveConvId, async () =>
            chatEngine.chat(ctx, {
              text: req.text,
              media,
              startedAt,
              effectiveTime,
              sourceConversationEventId: source?.eventId,
              ...(trackedShadowObserver && source
                ? {
                    contextShadow: {
                      observer: trackedShadowObserver,
                      sourceEventId: source.eventId,
                      conversationStreamId: source.streamId,
                      eventCursor: source.streamSeq,
                    },
                  }
                : {}),
              ...(runLedgerInput && source ? { runLedger: runLedgerInput } : {}),
              // Phase 6：读路径三态（rollout 关闭 / legacy 快照 → 缺省 legacy）。
              ...(options.contextReadPath && options.contextReadPath !== "legacy"
                ? { contextReadPath: options.contextReadPath }
                : {}),
              // Phase 7：记忆注入三态（缺省 tape；接线层已保证 runLedger 开启）。
              ...(options.memoryReadPath && options.memoryReadPath !== "tape"
                ? { memoryReadPath: options.memoryReadPath }
                : {}),
            }),
          ),
        );

        if (reply.text?.trim()) {
          void generateTitleIfNeeded(accountId, effectiveConvId, {
            userText: req.text,
            assistantText: reply.text,
          }).catch((err) => {
            agentLogger.warn(
              {
                ...getErrorFields(err),
                accountId,
                conversationId: effectiveConvId,
              },
              "会话标题生成失败",
            );
          });
        }

        // Reset the proactive pulse: the user just spoke, so the agent has
        // no reason to bubble up again soon.
        void notePulseActivity(accountId, effectiveConvId).catch((err) => {
          agentLogger.warn(
            {
              ...getErrorFields(err),
              accountId,
              conversationId: effectiveConvId,
            },
            "更新会话节拍失败",
          );
        });

        return withSpanSync(
          "message.send",
          {
            hasText: Boolean(reply.text),
            hasMedia: Boolean(reply.media),
            completionSnapshot: reply.text ?? "",
          },
          () => {
            log.send(accountId, req.conversationId, reply.text ?? "");
            return reply;
          },
        );
      } catch (err) {
        if (source && options.contextShadowObserver && !shadowStarted) {
          options.contextShadowObserver.skipTurnFailed();
        }
        if (isLLMProviderNotConfiguredError(err)) {
          agentLogger.warn(
            {
              ...getErrorFields(err),
              accountId,
              conversationId: effectiveConvId,
            },
            "LLM Provider 尚未配置",
          );
          return { text: err.userMessage };
        }

        log.error(`chat(${accountId}/${req.conversationId})`, err);
        return { text: "抱歉，出了点问题，请稍后再试。" };
      } finally {
        const trace = getActiveTrace();
        if (trace && trace.getSpans().length > 0) {
          observabilityService.queuePersistTrace(trace.summarize(), trace.getSpans());
        }
      }
    });
  }

  return {
    chat(req) {
      return chat(req);
    },

    chatFromIngress(req, source) {
      return chat(req, source);
    },

    async clearFromIngress(receiptId, wechatConversationId) {
      const key = `${accountId}::${wechatConversationId}`;
      const effectiveConversationId = await getEffectiveConvId(accountId, wechatConversationId);
      log.clear(accountId, wechatConversationId);
      await chatEngine.conversations.withLock(accountId, effectiveConversationId, async () => {
        await clearIngressSession({
          accountId,
          receiptId,
          wechatConversationId,
          effectiveConversationId,
        });
        chatEngine.conversations.evict(accountId, effectiveConversationId);
        sessionCache.delete(key);
      });
    },

    async clearSession(wechatConvId: string) {
      const k = `${accountId}::${wechatConvId}`;
      const effective = sessionCache.get(k) ?? wechatConvId;
      log.clear(accountId, wechatConvId);
      await chatEngine.conversations.withLock(accountId, effective, async () => {
        await chatEngine.conversations.clear(accountId, effective);
      });
      sessionCache.delete(k);
      await deleteRoute(accountId, wechatConvId);
    },
  };
}
