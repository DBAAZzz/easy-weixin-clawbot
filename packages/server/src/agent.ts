import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  getActiveTrace,
  runWithTrace,
  withSpan,
  withSpanSync,
} from "@clawbot/observability";
import type { Agent, ChatRequest, ChatResponse } from "@clawbot/weixin-agent-sdk";
import {
  chat,
  CommandRegistry,
  builtinCommands,
  scheduleCommand,
  setSchedulerContext,
  clearConversation,
  evictConversation,
  withConversationLock,
  createHandoffAnchors,
  checkWaitingGoalsAsync,
  currentSeq,
  setHeartbeatToolContext,
} from "@clawbot/agent";
import { getSchedulerStore } from "@clawbot/agent/ports";
import { sendProactiveMessage } from "./proactive-push.js";
import { updateContextToken } from "./db/conversations.js";
import { deleteRoute, getRoute, upsertRoute } from "./db/session-routes.js";
import { createModuleLogger, getErrorFields, log } from "./logger.js";
import { observabilityService } from "./observability/service.js";
import { TTS_CACHE_DIR } from "./paths.js";
import { getTTSProvider } from "./services/tts/index.js";

const commandRegistry = new CommandRegistry();
commandRegistry.registerAll(builtinCommands);
commandRegistry.register(scheduleCommand);

const agentLogger = createModuleLogger("agent");

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

  evictConversation(accountId, oldEffective);
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
    agentLogger.error(
      { ...getErrorFields(err) },
      "TTS 合成失败，将回退为纯文本回复",
    );
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
      await sendProactiveMessage(accountId, conversationId, header + run.result);
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

/** Create an Agent bound to a specific WeChat account. */
export function createAgent(accountId: string): Agent {
  return {
    async chat(req: ChatRequest): Promise<ChatResponse> {
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
              { hasText: Boolean(reply.text), hasMedia: Boolean(reply.media), completionSnapshot: reply.text ?? "" },
              () => {
                log.send(accountId, req.conversationId, reply.text ?? "");
                return reply;
              },
            );
          }

          // Inject scheduler + heartbeat context so tools know the active account/conversation
          setSchedulerContext({ accountId, conversationId: req.conversationId });
          setHeartbeatToolContext({ accountId, conversationId: effectiveConvId });
          const reply = await withSpan("conversation.lock", {}, async () =>
            withConversationLock(accountId, effectiveConvId, async () =>
              chat(accountId, effectiveConvId, req.text, req.media, startedAt),
            ),
          );
          setSchedulerContext(null);
          setHeartbeatToolContext(null);

          // Post-chat hook: notify heartbeat engine of new user/assistant messages
          const latestSeq = currentSeq(accountId, effectiveConvId);
          checkWaitingGoalsAsync(accountId, effectiveConvId, latestSeq).catch((err) => {
            agentLogger.warn(
              {
                ...getErrorFields(err),
                accountId,
                conversationId: effectiveConvId,
                seq: latestSeq,
              },
              "心跳后置检查失败",
            );
          });

          return withSpanSync(
            "message.send",
            { hasText: Boolean(reply.text), hasMedia: Boolean(reply.media), completionSnapshot: reply.text ?? "" },
            () => {
              log.send(accountId, req.conversationId, reply.text ?? "");
              return reply;
            },
          );
        } catch (err) {
          log.error(`chat(${accountId}/${req.conversationId})`, err);
          return { text: "抱歉，出了点问题，请稍后再试。" };
        } finally {
          const trace = getActiveTrace();
          if (trace && trace.getSpans().length > 0) {
            observabilityService.queuePersistTrace(trace.summarize(), trace.getSpans());
          }
        }
      });
    },

    clearSession(wechatConvId: string) {
      const k = `${accountId}::${wechatConvId}`;
      const effective = sessionCache.get(k) ?? wechatConvId;
      log.clear(accountId, wechatConvId);
      clearConversation(accountId, effective);
      sessionCache.delete(k);
      void deleteRoute(accountId, wechatConvId).catch((err) => {
        log.error(`deleteRoute(${accountId}/${wechatConvId})`, err);
      });
    },
  };
}
