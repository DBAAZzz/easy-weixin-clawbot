import type { Context } from "hono";
import { verifyWebhookToken, logWebhookCall } from "./db.js";
import { getContextToken } from "../db/conversations.js";
import { formatWebhookLogContent, normalizeWebhookMessageBody } from "./payload.js";
import { sendWebhookMessage } from "./sender.js";

export async function handleWebhook(c: Context) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "invalid_token", message: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.substring(7);
  const verified = await verifyWebhookToken(token);

  if (!verified) {
    return c.json({ error: "invalid_token", message: "Token is invalid or disabled" }, 401);
  }

  let message;
  try {
    message = normalizeWebhookMessageBody(await c.req.json());
  } catch (error) {
    return c.json(
      {
        error: "invalid_params",
        message: error instanceof Error ? error.message : "Invalid webhook payload",
      },
      400,
    );
  }

  const content = formatWebhookLogContent(message);

  if (!verified.accountIds.includes(message.accountId)) {
    await logWebhookCall({
      tokenId: verified.tokenId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      content,
      status: "rejected",
      error: "account_not_authorized",
    });
    return c.json({ error: "account_not_authorized", message: "Token not authorized for this account" }, 403);
  }

  const contextToken = await getContextToken(message.accountId, message.conversationId);
  if (!contextToken) {
    await logWebhookCall({
      tokenId: verified.tokenId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      content,
      status: "rejected",
      error: "conversation_not_found",
    });
    return c.json({
      error: "conversation_not_found",
      message: "Conversation not found or expired (>24h inactive)"
    }, 404);
  }

  try {
    const result = await sendWebhookMessage({
      accountId: message.accountId,
      conversationId: message.conversationId,
      contextToken,
      message,
    });

    await logWebhookCall({
      tokenId: verified.tokenId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      content,
      status: "success",
    });

    return c.json({ success: true, messageId: result.messageId, type: message.messageType });
  } catch (err) {
    await logWebhookCall({
      tokenId: verified.tokenId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      content,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });

    return c.json({
      error: "send_failed",
      message: err instanceof Error ? err.message : "Failed to send message"
    }, 503);
  }
}
