/**
 * Prisma implementation of MessageStore interface from @clawbot/agent.
 *
 * Delegates to the existing db/messages.ts functions.
 */

import type { MessageStore, RestoredHistory, PersistMessageParams, MessagesSinceRow } from "@clawbot/agent/ports";
import {
  queuePersistMessage,
  restoreHistory as restoreHistoryImpl,
} from "./messages.js";
import { getPrisma } from "./prisma.js";

export class PrismaMessageStore implements MessageStore {
  async restoreHistory(accountId: string, conversationId: string): Promise<RestoredHistory> {
    return restoreHistoryImpl(accountId, conversationId);
  }

  queuePersistMessage(params: PersistMessageParams): void {
    queuePersistMessage(params);
  }

  async rollbackMessages(accountId: string, conversationId: string, count: number): Promise<void> {
    try {
      const rows = await getPrisma().message.findMany({
        where: { accountId, conversationId },
        orderBy: { seq: "desc" },
        take: count,
        select: { id: true },
      });
      if (rows.length > 0) {
        await getPrisma().message.deleteMany({
          where: { id: { in: rows.map((r) => r.id) } },
        });
      }
    } catch (err) {
      console.error(`[message-store] rollbackMessages(${accountId}/${conversationId}, ${count}):`, err);
    }
  }

  async clearMessages(accountId: string, conversationId: string): Promise<void> {
    const result = await getPrisma().message.deleteMany({
      where: { accountId, conversationId },
    });
    console.log(`[message-store] cleared ${accountId}/${conversationId} (deleted ${result.count} DB rows)`);
  }

  async getMessagesSince(
    accountId: string,
    conversationId: string,
    sinceSeq: number,
    limit: number,
  ): Promise<MessagesSinceRow[]> {
    const rows = await getPrisma().message.findMany({
      where: {
        accountId,
        conversationId,
        seq: { gt: sinceSeq },
      },
      orderBy: { seq: "asc" },
      take: limit,
      select: {
        seq: true,
        role: true,
        contentText: true,
      },
    });
    return rows.map((r) => ({
      seq: r.seq,
      role: r.role,
      textContent: r.contentText ?? "",
    }));
  }
}
