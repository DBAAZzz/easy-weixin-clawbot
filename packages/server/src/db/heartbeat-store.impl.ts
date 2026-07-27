/**
 * Prisma implementation of HeartbeatStore interface from @clawbot/agent.
 */

import type { HeartbeatStore } from "@clawbot/agent/ports";
import type { ReminderRow, CreateReminderInput } from "@clawbot/agent";
import { getPrisma } from "./prisma.js";

interface PrismaReminder {
  id: bigint;
  reminderId: string;
  accountId: string;
  conversationId: string;
  prompt: string;
  fireAt: Date;
  createdAt: Date;
}

function toReminderRow(row: PrismaReminder): ReminderRow {
  return {
    id: row.id,
    reminderId: row.reminderId,
    accountId: row.accountId,
    conversationId: row.conversationId,
    prompt: row.prompt,
    fireAt: row.fireAt,
    createdAt: row.createdAt,
  };
}

export class PrismaHeartbeatStore implements HeartbeatStore {
  async createReminder(input: CreateReminderInput): Promise<ReminderRow> {
    const row = await getPrisma().reminder.create({
      data: {
        accountId: input.accountId,
        conversationId: input.conversationId,
        prompt: input.prompt,
        fireAt: input.fireAt,
      },
    });
    return toReminderRow(row);
  }

  async findDue(now: Date, limit: number): Promise<ReminderRow[]> {
    const rows = await getPrisma().reminder.findMany({
      where: { fireAt: { lte: now } },
      orderBy: { fireAt: "asc" },
      take: limit,
    });
    return rows.map(toReminderRow);
  }

  async claimById(reminderId: string): Promise<ReminderRow | null> {
    // DELETE ... RETURNING is atomic: whoever deletes the row owns it, so
    // concurrent ticks (or a second process) cannot double-fire a reminder.
    try {
      const row = await getPrisma().reminder.delete({ where: { reminderId } });
      return toReminderRow(row);
    } catch {
      // P2025 — already claimed or never existed.
      return null;
    }
  }

  async listByAccount(accountId: string): Promise<ReminderRow[]> {
    const rows = await getPrisma().reminder.findMany({
      where: { accountId },
      orderBy: { fireAt: "asc" },
    });
    return rows.map(toReminderRow);
  }
}
