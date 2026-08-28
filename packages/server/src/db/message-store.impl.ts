/**
 * Prisma implementation of MessageStore interface from @clawbot/agent.
 *
 * Delegates to the existing db/messages.ts functions.
 */

import type { MessageStore, RestoredHistory, PersistMessageParams } from "@clawbot/agent/ports";
import {
  queuePersistMessage,
  restoreHistory as restoreHistoryImpl,
  waitForConversationMessageWrites,
} from "./messages.js";
import { createModuleLogger, getErrorFields } from "../logger.js";
import { getPrisma } from "./prisma.js";

const messageStoreLogger = createModuleLogger("message-store");

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
        const ids = rows.map((row) => row.id);
        await getPrisma().$transaction(async (tx) => {
          // A failed turn is not a cleared projection: remove its link before
          // rolling the transient legacy message back.
          await tx.legacyMessageProjectionLink.deleteMany({
            where: { messageId: { in: ids } },
          });
          await tx.message.deleteMany({ where: { id: { in: ids } } });
          await tx.$executeRaw`
            UPDATE "conversations"
            SET "message_count" = GREATEST("message_count" - ${rows.length}, 0)
            WHERE "account_id" = ${accountId} AND "conversation_id" = ${conversationId}
          `;
        });
      }
    } catch (err) {
      messageStoreLogger.error(
        {
          ...getErrorFields(err),
          accountId,
          conversationId,
          count,
        },
        "回滚消息失败",
      );
    }
  }

  async clearMessages(accountId: string, conversationId: string): Promise<void> {
    await waitForConversationMessageWrites(accountId, conversationId);
    const deletedCount = await getPrisma().$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "messages"
        WHERE "account_id" = ${accountId} AND "conversation_id" = ${conversationId}
        FOR UPDATE
      `;
      await tx.$executeRaw`
        UPDATE "legacy_message_projection_links"
        SET "state" = 'cleared', "message_id" = NULL, "cleared_at" = CURRENT_TIMESTAMP
        WHERE "account_id" = ${accountId}
          AND "conversation_id" = ${conversationId}
          AND "state" = 'persisted'
      `;
      const result = await tx.message.deleteMany({ where: { accountId, conversationId } });
      await tx.conversation.updateMany({
        where: { accountId, conversationId },
        data: { messageCount: 0, lastMessageAt: null },
      });
      return result.count;
    });
    messageStoreLogger.info(
      { accountId, conversationId, deletedCount },
      "已清空会话消息",
    );
  }

}
