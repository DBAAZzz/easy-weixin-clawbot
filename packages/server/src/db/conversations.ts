import { Prisma } from "@prisma/client";
import type { ConversationRow } from "@clawbot/shared";
import { getPrisma } from "./prisma.js";

export async function listConversations(accountId: string): Promise<ConversationRow[]> {
  const rows = await getPrisma().conversation.findMany({
    where: { accountId },
    include: { account: { select: { alias: true, displayName: true } } },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
  });

  return rows.map((row) => ({
    id: Number(row.id),
    account_id: row.accountId,
    account_alias: row.account.alias,
    account_display_name: row.account.displayName,
    conversation_id: row.conversationId,
    title: row.title,
    last_message_at: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    message_count: row.messageCount,
    created_at: row.createdAt.toISOString(),
  }));
}

export async function getConversationTitle(
  accountId: string,
  conversationId: string,
): Promise<string | null> {
  const row = await getPrisma().conversation.findUnique({
    where: { accountId_conversationId: { accountId, conversationId } },
    select: { title: true },
  });
  return row?.title ?? null;
}

export async function setConversationTitleIfEmpty(
  accountId: string,
  conversationId: string,
  title: string,
): Promise<void> {
  const normalized = title.trim();
  if (!normalized) return;

  const prisma = getPrisma();
  const result = await prisma.conversation.updateMany({
    where: {
      accountId,
      conversationId,
      OR: [{ title: null }, { title: "" }, { title: "未命名会话" }],
    },
    data: { title: normalized },
  });

  if (result.count > 0) {
    return;
  }

  const existing = await prisma.conversation.findUnique({
    where: { accountId_conversationId: { accountId, conversationId } },
    select: { id: true },
  });
  if (existing) {
    return;
  }

  try {
    await prisma.conversation.create({
      data: { accountId, conversationId, title: normalized },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await prisma.conversation.updateMany({
        where: {
          accountId,
          conversationId,
          OR: [{ title: null }, { title: "" }, { title: "未命名会话" }],
        },
        data: { title: normalized },
      });
      return;
    }
    throw error;
  }
}

export async function updateContextToken(
  accountId: string,
  conversationId: string,
  contextToken: string,
): Promise<void> {
  await getPrisma().conversation.upsert({
    where: { accountId_conversationId: { accountId, conversationId } },
    update: { contextToken },
    create: { accountId, conversationId, contextToken },
  });
}

export async function getContextToken(
  accountId: string,
  conversationId: string,
): Promise<string | null> {
  const conv = await getPrisma().conversation.findUnique({
    where: { accountId_conversationId: { accountId, conversationId } },
    select: { contextToken: true },
  });
  return conv?.contextToken ?? null;
}
