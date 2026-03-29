import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent, ChatRequest, ChatResponse } from "weixin-agent-sdk";
import { chat } from "./ai.js";
import { builtinCommands } from "./commands/builtins.js";
import { CommandRegistry } from "./commands/registry.js";
import { clearConversation, evictConversation, withConversationLock } from "./conversation.js";
import { log } from "./logger.js";
import { TTS_CACHE_DIR } from "./paths.js";
import { getTTSProvider } from "./services/tts/index.js";

const commandRegistry = new CommandRegistry();
commandRegistry.registerAll(builtinCommands);

/**
 * Maps wechatConvId → current effectiveConvId per account.
 * Key: `${accountId}::${wechatConvId}`
 * Default: effectiveConvId === wechatConvId (first session).
 * After /reset: effectiveConvId = `${wechatConvId}#${timestamp}` — a new DB conversation.
 */
const sessionRoutes = new Map<string, string>();

function getEffectiveConvId(accountId: string, wechatConvId: string): string {
  const k = `${accountId}::${wechatConvId}`;
  if (!sessionRoutes.has(k)) sessionRoutes.set(k, wechatConvId);
  return sessionRoutes.get(k)!;
}

function rotateSession(accountId: string, wechatConvId: string): string {
  const k = `${accountId}::${wechatConvId}`;
  const oldEffective = sessionRoutes.get(k) ?? wechatConvId;
  const newEffective = `${wechatConvId}#${Date.now()}`;
  evictConversation(accountId, oldEffective);
  sessionRoutes.set(k, newEffective);
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

      const startedAt = Date.now();
      const effectiveConvId = getEffectiveConvId(accountId, req.conversationId);

      // 内置命令拦截（不经过 LLM）
      const dispatched = commandRegistry.tryDispatch(req.text);
      if (dispatched) {
        const reply = await dispatched.command.execute({
          accountId,
          conversationId: effectiveConvId,
          args: dispatched.args,
          startedAt,
          commands: commandRegistry.list(),
          rotateSession: () => {
            rotateSession(accountId, req.conversationId);
            return Promise.resolve();
          },
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
      const effective = getEffectiveConvId(accountId, wechatConvId);
      log.clear(accountId, wechatConvId);
      clearConversation(accountId, effective);
      sessionRoutes.delete(`${accountId}::${wechatConvId}`);
    },
  };
}
