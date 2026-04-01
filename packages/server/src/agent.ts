import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent, ChatRequest, ChatResponse } from "weixin-agent-sdk";
import { chat } from "./ai.js";
import { builtinCommands } from "./commands/builtins.js";
import { CommandRegistry } from "./commands/registry.js";
import { clearConversation, evictConversation, withConversationLock } from "./conversation.js";
import { updateContextToken } from "./db/conversations.js";
import { deleteRoute, getRoute, upsertRoute } from "./db/session-routes.js";
import { log } from "./logger.js";
import { TTS_CACHE_DIR } from "./paths.js";
import { getTTSProvider } from "./services/tts/index.js";

const commandRegistry = new CommandRegistry();
commandRegistry.registerAll(builtinCommands);

/**
 * In-memory cache of wechatConvId → effectiveConvId per account.
 * Key: `${accountId}::${wechatConvId}`
 * Populated lazily from DB on first use; persisted to DB on /reset so the
 * mapping survives server restarts.
 */
const sessionCache = new Map<string, string>();

async function getEffectiveConvId(accountId: string, wechatConvId: string): Promise<string> {
  const k = `${accountId}::${wechatConvId}`;
  if (sessionCache.has(k)) return sessionCache.get(k)!;

  // Cache miss — check DB (populated on /reset, null if no reset has occurred)
  const persisted = await getRoute(accountId, wechatConvId);
  const effective = persisted ?? wechatConvId;
  sessionCache.set(k, effective);
  return effective;
}

async function rotateSession(accountId: string, wechatConvId: string): Promise<string> {
  const k = `${accountId}::${wechatConvId}`;
  const oldEffective = sessionCache.get(k) ?? wechatConvId;
  const newEffective = `${wechatConvId}#${Date.now()}`;
  evictConversation(accountId, oldEffective);
  sessionCache.set(k, newEffective);
  await upsertRoute(accountId, wechatConvId, newEffective);
  return newEffective;
}

mkdirSync(TTS_CACHE_DIR, { recursive: true });

/**
 * Synthesize reply text to an audio file and return its path.
 * Returns undefined if TTS fails (non-fatal — text reply still goes through).
 */
async function synthesizeReply(text: string): Promise<string | undefined> {
  try {
    const tts = getTTSProvider();
    const result = await tts.synthesize(text);
    const fileName = `tts-${Date.now()}.${result.format}`;
    const filePath = join(TTS_CACHE_DIR, fileName);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(filePath, result.audio);
    console.log(
      `[tts] synthesized ${result.audio.length} bytes, ` +
        `${result.duration?.toFixed(1) ?? "?"}s → ${filePath}`,
    );
    return filePath;
  } catch (err) {
    console.error("[tts] synthesis failed (text reply will still be sent):", err);
    return undefined;
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
      }

      const startedAt = Date.now();
      const effectiveConvId = await getEffectiveConvId(accountId, req.conversationId);

      // 内置命令拦截（不经过 LLM）
      const dispatched = commandRegistry.tryDispatch(req.text);
      if (dispatched) {
        const reply = await dispatched.command.execute({
          accountId,
          conversationId: effectiveConvId,
          args: dispatched.args,
          startedAt,
          commands: commandRegistry.list(),
          rotateSession: () => rotateSession(accountId, req.conversationId).then(() => undefined),
        });
        log.send(accountId, req.conversationId, reply.text ?? "");
        return reply;
      }

      return withConversationLock(accountId, effectiveConvId, async () => {
        try {
          const reply = await chat(accountId, effectiveConvId, req.text, req.media, startedAt);
          log.send(accountId, req.conversationId, reply.text ?? "");
          return reply;
        } catch (err) {
          log.error(`chat(${accountId}/${req.conversationId})`, err);
          return { text: "抱歉，出了点问题，请稍后再试。" };
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
