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
