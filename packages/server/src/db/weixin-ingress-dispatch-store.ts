import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";

export type IngressDispatchStatus = "pending" | "processing" | "completed" | "failed";
export type IngressDispatchOutcome = "chat" | "command" | "failed";

export interface IngressDispatchReceipt {
  eventId: string;
  accountId: string;
  status: IngressDispatchStatus;
  outcome: IngressDispatchOutcome | null;
  attemptCount: number;
  claimedAt: Date | null;
  completedAt: Date | null;
  errorCode: string | null;
}

export class WeixinIngressDispatchStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}
  private get prisma(): PrismaClient { return this.injectedPrisma ?? getPrisma(); }

  async createAndClaim(eventId: string, accountId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "weixin_ingress_dispatches" ("event_id", "account_id")
        VALUES (${eventId}, ${accountId})
        ON CONFLICT ("event_id") DO NOTHING
      `);
      const receipts = await tx.$queryRaw<Array<{ accountId: string }>>(Prisma.sql`
        SELECT "account_id" AS "accountId"
        FROM "weixin_ingress_dispatches"
        WHERE "event_id" = ${eventId}
      `);
      if (receipts[0]?.accountId !== accountId) {
        throw new Error("ingress_receipt_account_mismatch");
      }
      const claimed = await tx.$queryRaw<Array<{ eventId: string }>>(Prisma.sql`
        UPDATE "weixin_ingress_dispatches"
        SET "status" = 'processing', "attempt_count" = "attempt_count" + 1,
            "claimed_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
        WHERE "event_id" = ${eventId} AND "account_id" = ${accountId}
          AND "status" = 'pending' AND "attempt_count" = 0
        RETURNING "event_id" AS "eventId"
      `);
      return claimed.length === 1;
    });
  }

  async get(eventId: string): Promise<IngressDispatchReceipt | null> {
    const row = await this.prisma.weixinIngressDispatch.findUnique({ where: { eventId } });
    if (!row) return null;
    if (!["pending", "processing", "completed", "failed"].includes(row.status)) {
      throw new Error("invalid_ingress_dispatch_status");
    }
    if (row.outcome !== null && !["chat", "command", "failed"].includes(row.outcome)) {
      throw new Error("invalid_ingress_dispatch_outcome");
    }
    return {
      eventId: row.eventId,
      accountId: row.accountId,
      status: row.status as IngressDispatchStatus,
      outcome: row.outcome as IngressDispatchOutcome | null,
      attemptCount: row.attemptCount,
      claimedAt: row.claimedAt,
      completedAt: row.completedAt,
      errorCode: row.errorCode,
    };
  }

  async settle(
    eventId: string,
    outcome: IngressDispatchOutcome,
    errorCode?: string,
  ): Promise<void> {
    const status = outcome === "failed" ? "failed" : "completed";
    const stableErrorCode = outcome === "failed" ? (errorCode ?? "business_processing_failed") : null;
    const rows = await this.prisma.$queryRaw<Array<{ eventId: string }>>(Prisma.sql`
      UPDATE "weixin_ingress_dispatches"
      SET "status" = ${status}, "outcome" = ${outcome},
          "completed_at" = CURRENT_TIMESTAMP, "error_code" = ${stableErrorCode},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "event_id" = ${eventId} AND "status" = 'processing'
      RETURNING "event_id" AS "eventId"
    `);
    if (rows.length !== 1) throw new Error("invalid_ingress_settle_transition");
  }

  async listStuck(olderThanSeconds: number): Promise<Array<{
    eventId: string; accountId: string; claimedAt: Date | null; identitySource: string; status: string;
  }>> {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT d."event_id" AS "eventId", d."account_id" AS "accountId",
             d."claimed_at" AS "claimedAt",
             COALESCE(e."payload"->'channelMetadata'->'data'->>'identitySource', 'unknown') AS "identitySource",
             d."status"
      FROM "weixin_ingress_dispatches" d
      JOIN "conversation_events" e ON e."event_id" = d."event_id"
      WHERE d."status" = 'processing' AND d."claimed_at" < ${cutoff}
      ORDER BY d."claimed_at" ASC
    `);
  }

  async markFailedByOperator(eventId: string, operator: string, reason: string): Promise<void> {
    if (!operator.trim() || !reason.trim() || reason.length > 500) {
      throw new Error("invalid_ingress_recovery_audit");
    }
    const rows = await this.prisma.$queryRaw<Array<{ eventId: string }>>(Prisma.sql`
      UPDATE "weixin_ingress_dispatches"
      SET "status" = 'failed', "outcome" = 'failed', "error_code" = 'operator_abandoned',
          "recovery_operator" = ${operator.trim()}, "recovery_reason" = ${reason.trim()},
          "recovered_at" = CURRENT_TIMESTAMP, "completed_at" = CURRENT_TIMESTAMP,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "event_id" = ${eventId} AND "status" = 'processing'
      RETURNING "event_id" AS "eventId"
    `);
    if (rows.length !== 1) throw new Error("invalid_ingress_recovery_transition");
  }
}
