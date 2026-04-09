/**
 * Prisma implementation of HeartbeatStore interface from @clawbot/agent.
 */

import type {
  HeartbeatStore,
} from "@clawbot/agent/ports";
import type {
  GoalStatus,
  PendingGoalRow,
  CreateGoalInput,
  UpdateGoalInput,
} from "@clawbot/agent";
import { getPrisma } from "./prisma.js";

const GOAL_HARD_EXPIRY_MS = 7 * 24 * 3600_000;

function toGoalRow(row: any): PendingGoalRow {
  return {
    id: row.id,
    goalId: row.goalId,
    accountId: row.accountId,
    sourceConversationId: row.sourceConversationId,
    description: row.description,
    context: row.context,
    originType: row.originType,
    originRef: row.originRef,
    status: row.status,
    nextCheckAt: row.nextCheckAt,
    checkCount: row.checkCount,
    maxChecks: row.maxChecks,
    backoffMs: row.backoffMs,
    latestSourceMessageSeq: row.latestSourceMessageSeq,
    resumeSignal: row.resumeSignal,
    lastCheckAt: row.lastCheckAt,
    lastCheckResult: row.lastCheckResult,
    resolution: row.resolution,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

export class PrismaHeartbeatStore implements HeartbeatStore {
  async createGoal(input: CreateGoalInput): Promise<PendingGoalRow> {
    const prisma = getPrisma();
    const now = new Date();
    const delayMs = input.delayMs ?? 5 * 60_000;

    const row = await prisma.pendingGoal.create({
      data: {
        accountId: input.accountId,
        sourceConversationId: input.sourceConversationId,
        description: input.description,
        context: input.context,
        originType: input.originType,
        originRef: input.originRef,
        status: "pending",
        nextCheckAt: new Date(now.getTime() + delayMs),
        maxChecks: input.maxChecks ?? 10,
        backoffMs: delayMs,
        expiresAt: new Date(now.getTime() + GOAL_HARD_EXPIRY_MS),
      },
    });

    return toGoalRow(row);
  }

  async getByGoalId(goalId: string): Promise<PendingGoalRow | null> {
    const prisma = getPrisma();
    const row = await prisma.pendingGoal.findUnique({ where: { goalId } });
    return row ? toGoalRow(row) : null;
  }

  async updateGoal(goalId: string, updates: UpdateGoalInput): Promise<void> {
    const prisma = getPrisma();
    await prisma.pendingGoal.update({
      where: { goalId },
      data: {
        ...(updates.status !== undefined && { status: updates.status }),
        ...(updates.nextCheckAt !== undefined && { nextCheckAt: updates.nextCheckAt }),
        ...(updates.checkCount !== undefined && { checkCount: updates.checkCount }),
        ...(updates.backoffMs !== undefined && { backoffMs: updates.backoffMs }),
        ...(updates.latestSourceMessageSeq !== undefined && {
          latestSourceMessageSeq: updates.latestSourceMessageSeq,
        }),
        ...(updates.resumeSignal !== undefined && { resumeSignal: updates.resumeSignal }),
        ...(updates.lastCheckAt !== undefined && { lastCheckAt: updates.lastCheckAt }),
        ...(updates.lastCheckResult !== undefined && { lastCheckResult: updates.lastCheckResult }),
        ...(updates.resolution !== undefined && { resolution: updates.resolution }),
        ...(updates.totalInputTokens !== undefined && {
          totalInputTokens: updates.totalInputTokens,
        }),
        ...(updates.totalOutputTokens !== undefined && {
          totalOutputTokens: updates.totalOutputTokens,
        }),
      },
    });
  }

  async findDueGoals(now: Date): Promise<PendingGoalRow[]> {
    const prisma = getPrisma();
    const rows = await prisma.pendingGoal.findMany({
      where: {
        status: "pending",
        nextCheckAt: { lte: now },
      },
      orderBy: { nextCheckAt: "asc" },
      take: 20,
    });
    return rows.map(toGoalRow);
  }

  async findByAccountAndStatus(
    accountId: string,
    conversationId: string,
    status: GoalStatus,
  ): Promise<PendingGoalRow[]> {
    const prisma = getPrisma();
    const rows = await prisma.pendingGoal.findMany({
      where: {
        accountId,
        sourceConversationId: conversationId,
        status,
      },
    });
    return rows.map(toGoalRow);
  }

  async countActiveGoals(accountId: string): Promise<number> {
    const prisma = getPrisma();
    return prisma.pendingGoal.count({
      where: {
        accountId,
        status: { in: ["pending", "checking", "waiting_user"] },
      },
    });
  }

  async findSimilarGoal(
    accountId: string,
    conversationId: string,
    description: string,
  ): Promise<PendingGoalRow | null> {
    const prisma = getPrisma();
    // Simple substring match — good enough for dedup
    const rows = await prisma.pendingGoal.findMany({
      where: {
        accountId,
        sourceConversationId: conversationId,
        status: { in: ["pending", "checking", "waiting_user"] },
      },
    });

    // Find one with high description overlap
    const needle = description.toLowerCase();
    for (const row of rows) {
      const existing = row.description.toLowerCase();
      if (existing.includes(needle) || needle.includes(existing)) {
        return toGoalRow(row);
      }
    }
    return null;
  }

  async listGoals(accountId: string, includeTerminal = false): Promise<PendingGoalRow[]> {
    const prisma = getPrisma();
    const where: any = { accountId };
    if (!includeTerminal) {
      where.status = { in: ["pending", "checking", "waiting_user"] };
    }
    const rows = await prisma.pendingGoal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map(toGoalRow);
  }

  async markUserReplied(goalId: string, messageSeq: number): Promise<void> {
    const prisma = getPrisma();
    await prisma.pendingGoal.update({
      where: { goalId },
      data: {
        resumeSignal: "user_replied",
        latestSourceMessageSeq: messageSeq,
      },
    });
  }

  async processResumeSignals(now: Date): Promise<number> {
    const prisma = getPrisma();
    const result = await prisma.pendingGoal.updateMany({
      where: {
        status: "waiting_user",
        resumeSignal: { not: null },
      },
      data: {
        status: "pending",
        nextCheckAt: now,
        backoffMs: 5 * 60 * 1000, // Reset backoff on user reply
      },
    });
    return result.count;
  }

  async abandonExpired(now: Date): Promise<number> {
    const prisma = getPrisma();

    // Abandon goals past expiresAt
    const byExpiry = await prisma.pendingGoal.updateMany({
      where: {
        status: { in: ["pending", "checking", "waiting_user"] },
        expiresAt: { not: null, lte: now },
      },
      data: {
        status: "abandoned",
        resolution: "expired",
        lastCheckAt: now,
      },
    });

    // Abandon goals that exceeded maxChecks
    // (Prisma doesn't support field-to-field comparison in updateMany,
    //  so we handle this in a raw query)
    const byMaxChecks = await prisma.$executeRaw`
      UPDATE pending_goals
      SET status = 'abandoned',
          resolution = 'max checks reached',
          last_check_at = ${now}
      WHERE status IN ('pending', 'waiting_user')
        AND check_count >= max_checks
    `;

    return byExpiry.count + byMaxChecks;
  }
}
