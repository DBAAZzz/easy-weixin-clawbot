import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Agent, ChatRequest, ChatResponse } from "weixin-agent-sdk";
import { chat } from "./ai.js";
import { clearConversation, withConversationLock } from "./conversation.js";
import { log } from "./logger.js";
import { TTS_CACHE_DIR } from "./paths.js";
import { getTTSProvider } from "./services/tts/index.js";

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
      return withConversationLock(accountId, req.conversationId, async () => {
        try {
          const reply = await chat(accountId, req.conversationId, req.text, req.media);
          log.send(accountId, req.conversationId, reply.text ?? "");
          return reply;
        } catch (err) {
          log.error(`chat(${accountId}/${req.conversationId})`, err);
          return { text: "抱歉，出了点问题，请稍后再试。" };
        }
      });
    },

    clearSession(conversationId: string) {
      log.clear(accountId, conversationId);
      clearConversation(accountId, conversationId);
    },
  };
}
