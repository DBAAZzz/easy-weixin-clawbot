/**
 * Prisma implementation of HeartbeatStore interface from @clawbot/agent.
 */

import type { HeartbeatStore } from "@clawbot/agent/ports";
import type { PulseRow, PulseUpdate } from "@clawbot/agent";
import { getPrisma } from "./prisma.js";

interface PrismaPulse {
  id: bigint;
  accountId: string;
  conversationId: string;
  nextEvalAt: Date;
  lastUserAt: Date | null;
  lastSpokeAt: Date | null;
  quietStreak: number;
  spokenDateKey: string | null;
  spokenToday: number;
}

function toPulseRow(row: PrismaPulse): PulseRow {
  return {
    id: row.id,
    accountId: row.accountId,
    conversationId: row.conversationId,
    nextEvalAt: row.nextEvalAt,
    lastUserAt: row.lastUserAt,
    lastSpokeAt: row.lastSpokeAt,
    quietStreak: row.quietStreak,
    spokenDateKey: row.spokenDateKey,
    spokenToday: row.spokenToday,
  };
}

export class PrismaHeartbeatStore implements HeartbeatStore {
  async notePulseActivity(
    accountId: string,
    conversationId: string,
    now: Date,
    nextEvalAt: Date,
  ): Promise<void> {
    await getPrisma().conversationPulse.upsert({
      where: { accountId_conversationId: { accountId, conversationId } },
      create: { accountId, conversationId, nextEvalAt, lastUserAt: now },
      update: { nextEvalAt, lastUserAt: now },
    });
  }

  async findDuePulses(now: Date, limit: number): Promise<PulseRow[]> {
    const rows = await getPrisma().conversationPulse.findMany({
      where: { nextEvalAt: { lte: now } },
      orderBy: { nextEvalAt: "asc" },
      take: limit,
    });
    return rows.map(toPulseRow);
  }

  async claimForEval(id: bigint, expectedNextEvalAt: Date, deferTo: Date): Promise<boolean> {
    const result = await getPrisma().conversationPulse.updateMany({
      where: { id, nextEvalAt: expectedNextEvalAt },
      data: { nextEvalAt: deferTo },
    });
    return result.count === 1;
  }

  async applyVerdict(id: bigint, updates: PulseUpdate): Promise<void> {
    await getPrisma().conversationPulse.update({
      where: { id },
      data: {
        nextEvalAt: updates.nextEvalAt,
        quietStreak: updates.quietStreak,
        ...(updates.lastSpokeAt !== undefined && { lastSpokeAt: updates.lastSpokeAt }),
        ...(updates.spokenDateKey !== undefined && { spokenDateKey: updates.spokenDateKey }),
        ...(updates.spokenToday !== undefined && { spokenToday: updates.spokenToday }),
      },
    });
  }
}
