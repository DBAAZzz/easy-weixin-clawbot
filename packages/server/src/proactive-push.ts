import { sendMessageWeixin, resolveWeixinAccount } from "@clawbot/weixin-agent-sdk";
import { getContextToken } from "./db/conversations.js";
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

  const account = resolveWeixinAccount(accountId);
  if (!account.configured) {
    throw new Error(`Account ${accountId} not configured`);
  }

  await sendMessageWeixin({
    to: conversationId,
    text,
    opts: {
      baseUrl: account.baseUrl,
      token: account.token,
      contextToken,
    },
  });

  log.send(accountId, conversationId, text);
}
