import { sendMessageWeixin } from "@clawbot/weixin-agent-sdk";
import { getContextToken } from "./db/conversations.js";
import { credentialStore } from "./credentials/index.js";
import { log } from "./logger.js";

export async function sendProactiveMessage(
  accountId: string,
  conversationId: string,
  text: string
): Promise<void> {
  const contextToken = await getContextToken(accountId, conversationId);
  if (!contextToken) {
    throw new Error(`No cached contextToken for ${accountId}/${conversationId}`);
  }

  const credential = await credentialStore.getDecrypted(accountId);
  if (!credential) {
    throw new Error(`Account ${accountId} has no active credential`);
  }

  await sendMessageWeixin({
    to: conversationId,
    text,
    opts: {
      baseUrl: credential.baseUrl,
      token: credential.token,
      contextToken,
    },
  });

  log.send(accountId, conversationId, text);
}
