import type { ConversationRow } from "@clawbot/shared";
import { getPrisma } from "./prisma.js";

export async function listConversations(accountId: string): Promise<ConversationRow[]> {
  const rows = await getPrisma().conversation.findMany({
    where: { accountId },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
  });

  return rows.map((row) => ({
    id: Number(row.id),
    account_id: row.accountId,
    conversation_id: row.conversationId,
    title: row.title,
    last_message_at: row.lastMessageAt ? row.lastMessageAt.toISOString() : null,
    message_count: row.messageCount,
    created_at: row.createdAt.toISOString(),
  }));
}
