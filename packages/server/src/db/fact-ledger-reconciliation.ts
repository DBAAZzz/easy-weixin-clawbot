import type { PrismaClient } from "@prisma/client";
import { weixinIngressReconcileTotal } from "@clawbot/observability";
import { getPrisma } from "./prisma.js";

export type ReconciliationResult = "linked" | "cleared" | "missing" | "unexpected" | "stuck";
export type ReconciliationIssueResult = "missing" | "unexpected" | "stuck";

export interface ReconciliationIssue {
  eventId: string;
  accountId: string;
  result: ReconciliationIssueResult;
}

export interface ReconciliationReport {
  summary: Record<ReconciliationResult, number>;
  issues: ReconciliationIssue[];
}

type Observation = Omit<ReconciliationIssue, "result"> & { result: ReconciliationResult };

export async function reconcileWeixinIngress(
  accountId: string,
  options: { graceSeconds?: number; stuckSeconds?: number } = {},
  injectedPrisma?: PrismaClient,
): Promise<ReconciliationReport> {
  const prisma = injectedPrisma ?? getPrisma();
  const now = Date.now();
  const graceMs = (options.graceSeconds ?? 30) * 1000;
  const stuckMs = (options.stuckSeconds ?? 300) * 1000;
  const rows = await prisma.weixinIngressDispatch.findMany({
    where: { accountId },
    include: { event: true },
  });
  const links = await prisma.legacyMessageProjectionLink.findMany({
    where: { accountId },
    include: { message: true },
  });
  const linksByEvent = new Map(links.map((link) => [link.eventId, link]));
  const observations: Observation[] = [];

  for (const row of rows) {
    const link = linksByEvent.get(row.eventId);
    if (row.status === "processing" && row.claimedAt && now - row.claimedAt.getTime() >= stuckMs) {
      observations.push({ eventId: row.eventId, accountId, result: "stuck" });
      continue;
    }
    if (row.status === "failed") {
      if (!row.errorCode) observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
      continue;
    }
    if (row.status !== "completed") continue;
    if (row.outcome === "command") {
      if (link) observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
      continue;
    }
    if (row.outcome !== "chat") {
      observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
      continue;
    }
    if (!link) {
      if (row.completedAt && now - row.completedAt.getTime() >= graceMs) {
        observations.push({ eventId: row.eventId, accountId, result: "missing" });
      }
      continue;
    }
    if (link.state === "cleared" && link.messageId === null && link.clearedAt) {
      observations.push({ eventId: row.eventId, accountId, result: "cleared" });
    } else if (
      link.state === "persisted" && link.messageId !== null && link.message?.role === "user" &&
      row.event.eventType === "inbound_message_received" && row.event.accountId === accountId
    ) {
      observations.push({ eventId: row.eventId, accountId, result: "linked" });
    } else {
      observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
    }
  }

  const summary: Record<ReconciliationResult, number> = {
    linked: 0,
    cleared: 0,
    missing: 0,
    unexpected: 0,
    stuck: 0,
  };
  for (const observation of observations) {
    summary[observation.result] += 1;
    weixinIngressReconcileTotal.inc({ result: observation.result });
  }
  return {
    summary,
    issues: observations.filter(
      (observation): observation is ReconciliationIssue =>
        observation.result === "missing"
        || observation.result === "unexpected"
        || observation.result === "stuck",
    ),
  };
}
