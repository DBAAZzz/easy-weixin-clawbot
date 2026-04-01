import { Hono } from "hono";
import { handleWebhook } from "./handler.js";
import { getContextToken } from "../db/conversations.js";
import { getPrisma } from "../db/prisma.js";
import { logWebhookCall } from "./db.js";
import { formatWebhookLogContent, normalizeWebhookMessageBody } from "./payload.js";
import { sendWebhookMessage } from "./sender.js";
import { generateWebhookToken, hashToken, getTokenPrefix } from "./token-utils.js";

export const webhookRoutes = new Hono();

// ── Webhook 投递接口（使用 webhook token 认证） ──
webhookRoutes.post("/", handleWebhook);

// ── Token 管理接口（使用 JWT 认证，由上层 middleware 处理） ──

// 创建 Token
webhookRoutes.post("/tokens", async (c) => {
  const body = await c.req.json();
  const { source, description, accountIds } = body;

  if (!source || !accountIds?.length) {
    return c.json({ error: "invalid_params", message: "source and accountIds are required" }, 400);
  }

  const existing = await getPrisma().webhookToken.findUnique({ where: { source } });
  if (existing) {
    return c.json({ error: "invalid_params", message: `source '${source}' already exists` }, 400);
  }

  const token = generateWebhookToken();
  const tokenHash = hashToken(token);
  const tokenPrefix = getTokenPrefix(token);

  await getPrisma().webhookToken.create({
    data: {
      source,
      tokenHash,
      tokenPrefix,
      description,
      permissions: {
        create: accountIds.map((accountId: string) => ({ accountId })),
      },
    },
  });

  return c.json({ token, source, accountIds, enabled: true, createdAt: new Date().toISOString() });
});

// 列出所有 Tokens
webhookRoutes.get("/tokens", async (c) => {
  const tokens = await getPrisma().webhookToken.findMany({
    include: { permissions: { select: { accountId: true } } },
    orderBy: { createdAt: "desc" },
  });

  return c.json({
    data: tokens.map((t) => ({
      source: t.source,
      tokenPrefix: t.tokenPrefix,
      description: t.description,
      accountIds: t.permissions.map((p) => p.accountId),
      enabled: t.enabled,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
    })),
  });
});

// 禁用/启用 Token
webhookRoutes.patch("/tokens/:source", async (c) => {
  const source = c.req.param("source");
  const body = await c.req.json();

  const token = await getPrisma().webhookToken.findUnique({ where: { source } });
  if (!token) {
    return c.json({ error: "not_found", message: "Token not found" }, 404);
  }

  await getPrisma().webhookToken.update({
    where: { source },
    data: { enabled: body.enabled },
  });

  return c.json({ success: true });
});

// 更新账号授权
webhookRoutes.patch("/tokens/:source/accounts", async (c) => {
  const source = c.req.param("source");
  const body = await c.req.json();
  const { add, remove } = body;

  const token = await getPrisma().webhookToken.findUnique({ where: { source } });
  if (!token) {
    return c.json({ error: "not_found", message: "Token not found" }, 404);
  }

  if (remove?.length) {
    await getPrisma().webhookAccountPermission.deleteMany({
      where: { tokenId: token.id, accountId: { in: remove } },
    });
  }

  if (add?.length) {
    await getPrisma().webhookAccountPermission.createMany({
      data: add.map((accountId: string) => ({ tokenId: token.id, accountId })),
      skipDuplicates: true,
    });
  }

  const updated = await getPrisma().webhookAccountPermission.findMany({
    where: { tokenId: token.id },
    select: { accountId: true },
  });

  return c.json({ success: true, accountIds: updated.map((p) => p.accountId) });
});

// 轮换 Token
webhookRoutes.post("/tokens/:source/rotate", async (c) => {
  const source = c.req.param("source");

  const existing = await getPrisma().webhookToken.findUnique({
    where: { source },
    include: { permissions: { select: { accountId: true } } },
  });
  if (!existing) {
    return c.json({ error: "not_found", message: "Token not found" }, 404);
  }

  const newToken = generateWebhookToken();
  const newHash = hashToken(newToken);
  const newPrefix = getTokenPrefix(newToken);

  await getPrisma().webhookToken.update({
    where: { source },
    data: { tokenHash: newHash, tokenPrefix: newPrefix },
  });

  return c.json({
    token: newToken,
    source,
    accountIds: existing.permissions.map((p) => p.accountId),
    rotatedAt: new Date().toISOString(),
  });
});

// 删除 Token
webhookRoutes.delete("/tokens/:source", async (c) => {
  const source = c.req.param("source");

  const token = await getPrisma().webhookToken.findUnique({ where: { source } });
  if (!token) {
    return c.json({ error: "not_found", message: "Token not found" }, 404);
  }

  await getPrisma().webhookToken.delete({ where: { source } });
  return c.json({ success: true });
});

// 管理端测试发送
webhookRoutes.post("/tokens/:source/test", async (c) => {
  const source = c.req.param("source");
  const token = await getPrisma().webhookToken.findUnique({
    where: { source },
    include: { permissions: { select: { accountId: true } } },
  });

  if (!token) {
    return c.json({ error: "not_found", message: "Token not found" }, 404);
  }

  if (!token.enabled) {
    return c.json({ error: "token_disabled", message: "Token is disabled" }, 409);
  }

  let message;
  try {
    message = normalizeWebhookMessageBody(await c.req.json());
  } catch (error) {
    return c.json(
      {
        error: "invalid_params",
        message: error instanceof Error ? error.message : "Invalid test payload",
      },
      400,
    );
  }

  const authorizedAccountIds = token.permissions.map((permission) => permission.accountId);
  const content = formatWebhookLogContent(message);

  if (!authorizedAccountIds.includes(message.accountId)) {
    await logWebhookCall({
      tokenId: token.id,
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
      tokenId: token.id,
      accountId: message.accountId,
      conversationId: message.conversationId,
      content,
      status: "rejected",
      error: "conversation_not_found",
    });
    return c.json({
      error: "conversation_not_found",
      message: "Conversation not found or expired (>24h inactive)",
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
      tokenId: token.id,
      accountId: message.accountId,
      conversationId: message.conversationId,
      content,
      status: "success",
    });

    return c.json({
      success: true,
      messageId: result.messageId,
      type: message.messageType,
    });
  } catch (error) {
    await logWebhookCall({
      tokenId: token.id,
      accountId: message.accountId,
      conversationId: message.conversationId,
      content,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json({
      error: "send_failed",
      message: error instanceof Error ? error.message : "Failed to send message",
    }, 503);
  }
});

// 查询调用日志
webhookRoutes.get("/tokens/:source/logs", async (c) => {
  const source = c.req.param("source");
  const limit = Number(c.req.query("limit") ?? "20");

  const token = await getPrisma().webhookToken.findUnique({ where: { source } });
  if (!token) {
    return c.json({ error: "not_found", message: "Token not found" }, 404);
  }

  const logs = await getPrisma().webhookLog.findMany({
    where: { tokenId: token.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });

  return c.json({
    data: logs.map((l) => ({
      accountId: l.accountId,
      conversationId: l.conversationId,
      status: l.status,
      error: l.error,
      createdAt: l.createdAt.toISOString(),
    })),
  });
});
