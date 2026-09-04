import type { PrismaClient } from "@prisma/client";
import { weixinIngressReconcileTotal } from "@clawbot/observability";
import { getPrisma } from "./prisma.js";

export type ReconciliationResult =
  | "linked"
  | "cleared"
  | "missing"
  | "unexpected"
  | "stuck"
  | "zombie_run";
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
  options: { graceSeconds?: number; stuckSeconds?: number; zombieRunSeconds?: number } = {},
  injectedPrisma?: PrismaClient,
): Promise<ReconciliationReport> {
  const prisma = injectedPrisma ?? getPrisma();
  const now = Date.now();
  const graceMs = (options.graceSeconds ?? 30) * 1000;
  const stuckMs = (options.stuckSeconds ?? 300) * 1000;
  const zombieRunMs = (options.zombieRunSeconds ?? 600) * 1000;
  const rows = await prisma.weixinIngressDispatch.findMany({
    where: { accountId },
    include: { event: true },
  });
  const links = await prisma.legacyMessageProjectionLink.findMany({
    where: { accountId },
    include: { message: true },
  });
  const linksByEvent = new Map(links.map((link) => [link.eventId, link]));
  const clearReceiptIds = rows
    .filter((row) => row.commandName === "clear")
    .map((row) => row.eventId);
  const clearBoundaries =
    clearReceiptIds.length === 0
      ? []
      : await prisma.conversationEvent.findMany({
          where: {
            accountId,
            eventType: "session_rotated",
            causationId: { in: clearReceiptIds },
          },
          select: { causationId: true },
        });
  const clearReceiptsWithBoundary = new Set(
    clearBoundaries.flatMap((event) => (event.causationId ? [event.causationId] : [])),
  );
  const observations: Observation[] = [];

  for (const row of rows) {
    const link = linksByEvent.get(row.eventId);
    if (row.commandName === "clear" && !clearReceiptsWithBoundary.has(row.eventId)) {
      observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
      continue;
    }
    if (row.status === "processing" && row.claimedAt && now - row.claimedAt.getTime() >= stuckMs) {
      observations.push({ eventId: row.eventId, accountId, result: "stuck" });
      continue;
    }
    if (row.status === "failed") {
      if (!row.errorCode)
        observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
      continue;
    }
    if (row.status !== "completed") continue;
    if (row.outcome === "command") {
      if (link) {
        observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
      }
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
      link.state === "persisted" &&
      link.messageId !== null &&
      link.message?.role === "user" &&
      row.event.eventType === "inbound_message_received" &&
      row.event.accountId === accountId
    ) {
      observations.push({ eventId: row.eventId, accountId, result: "linked" });
    } else {
      observations.push({ eventId: row.eventId, accountId, result: "unexpected" });
    }
  }

  // ── Run Ledger observations (Phase 4 design §14) ──────────────────
  // Zombie runs: started but no terminal event past the threshold. Runs ended
  // by `run_interrupted{ledger_degraded}` are terminal and never zombie —
  // in-process fail-open degradation is a legitimate shape, not an anomaly.
  const zombieCutoff = new Date(now - zombieRunMs);
  const startedRuns = await prisma.agentRunEvent.findMany({
    where: { accountId, eventType: "run_started", recordedAt: { lt: zombieCutoff } },
    select: { runId: true, eventId: true },
  });
  if (startedRuns.length > 0) {
    const terminalRuns = await prisma.agentRunEvent.findMany({
      where: {
        accountId,
        runId: { in: startedRuns.map((run) => run.runId) },
        eventType: { in: ["run_completed", "run_interrupted"] },
      },
      select: { runId: true },
      distinct: ["runId"],
    });
    const terminalRunIds = new Set(terminalRuns.map((run) => run.runId));
    for (const run of startedRuns) {
      if (!terminalRunIds.has(run.runId)) {
        observations.push({ eventId: run.eventId, accountId, result: "zombie_run" });
      }
    }
  }

  // Delivered outbound facts must correlate to a terminal run. Two shapes are
  // legitimate (Phase 6 design §12):
  // - ingress settle facts: causationId = receipt id AND the run started on the
  //   SAME stream (the receipt-triggered run);
  // - proactive facts (heartbeat/scheduler push): causationId = runId —
  //   correlated by run identity alone, because the run's execution stream
  //   (scheduler:{seq}) legitimately differs from the target conversation.
  // Missing delivery_requested with delivery_succeeded is NOT flagged: that is
  // the documented degraded-run shape, visible via run_interrupted instead.
  const deliveredFacts = await prisma.conversationEvent.findMany({
    where: { accountId, eventType: "outbound_message_delivered" },
    select: { eventId: true, causationId: true, streamId: true },
  });
  if (deliveredFacts.length > 0) {
    const receiptIds = [
      ...new Set(
        deliveredFacts
          .map((fact) => fact.causationId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const runStarts =
      receiptIds.length > 0
        ? await prisma.agentRunEvent.findMany({
            where: { accountId, eventType: "run_started", causationId: { in: receiptIds } },
            select: { runId: true, causationId: true, conversationStreamId: true },
          })
        : [];
    const terminalRunIds = new Set(
      runStarts.length === 0
        ? []
        : (
            await prisma.agentRunEvent.findMany({
              where: {
                accountId,
                runId: { in: [...new Set(runStarts.map((start) => start.runId))]},
                eventType: { in: ["run_completed", "run_interrupted"] },
              },
              select: { runId: true },
              distinct: ["runId"],
            })
          ).map((run) => run.runId),
    );
    const correlatedTriggers = new Set(
      runStarts
        .filter((start) => start.causationId && terminalRunIds.has(start.runId))
        .map((start) => `${start.causationId}\u0000${start.conversationStreamId}`),
    );
    const uncorrelated = deliveredFacts.filter(
      (fact) =>
        fact.causationId !== null &&
        !correlatedTriggers.has(`${fact.causationId}\u0000${fact.streamId}`),
    );
    // Proactive shape: causationId IS the runId of a terminal run (§12 —
    // streamId deliberately not compared, because a scheduler run executes in
    // its isolated conversation and delivers into the target conversation).
    const proactiveCandidates = [
      ...new Set(
        uncorrelated
          .map((fact) => fact.causationId!)
          .filter((id) => id.length > 0),
      ),
    ];
    const proactiveStarts =
      proactiveCandidates.length === 0
        ? []
        : await prisma.agentRunEvent.findMany({
            where: { accountId, eventType: "run_started", runId: { in: proactiveCandidates } },
            select: { runId: true },
            distinct: ["runId"],
          });
    const proactiveTerminalRunIds = new Set(
      proactiveStarts.length === 0
        ? []
        : (
            await prisma.agentRunEvent.findMany({
              where: {
                accountId,
                runId: { in: proactiveStarts.map((start) => start.runId) },
                eventType: { in: ["run_completed", "run_interrupted"] },
              },
              select: { runId: true },
              distinct: ["runId"],
            })
          ).map((run) => run.runId),
    );
    const proactiveCorrelated = new Set(
      uncorrelated
        .map((fact) => fact.causationId!)
        .filter((runId) => proactiveTerminalRunIds.has(runId)),
    );
    for (const fact of deliveredFacts) {
      if (!fact.causationId) continue;
      if (correlatedTriggers.has(`${fact.causationId}\u0000${fact.streamId}`)) continue;
      if (proactiveCorrelated.has(fact.causationId)) continue;
      observations.push({ eventId: fact.eventId, accountId, result: "unexpected" });
    }
  }

  const summary: Record<ReconciliationResult, number> = {
    linked: 0,
    cleared: 0,
    missing: 0,
    unexpected: 0,
    stuck: 0,
    zombie_run: 0,
  };
  for (const observation of observations) {
    summary[observation.result] += 1;
    weixinIngressReconcileTotal.inc({ result: observation.result });
  }
  return {
    summary,
    issues: observations.filter(
      (observation): observation is ReconciliationIssue =>
        observation.result === "missing" ||
        observation.result === "unexpected" ||
        observation.result === "stuck",
    ),
  };
}
