import { appendAssistantTextMessage } from "@clawbot/agent/conversation";
import { sendMessageWeixin } from "@clawbot/weixin-agent-sdk";
import { getContextToken } from "./db/conversations.js";
import { getRoute } from "./db/session-routes.js";
import { credentialStore } from "./credentials/index.js";
import { createModuleLogger, getErrorFields, log } from "./logger.js";

const proactivePushLogger = createModuleLogger("proactive-push");

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

  try {
    const effectiveConversationId = (await getRoute(accountId, conversationId)) ?? conversationId;
    await appendAssistantTextMessage(accountId, effectiveConversationId, text);
  } catch (error) {
    proactivePushLogger.warn(
      {
        ...getErrorFields(error),
        accountId,
        conversationId,
      },
      "主动推送已发送，但写入会话历史失败",
    );
  }

  log.send(accountId, conversationId, text);
}
