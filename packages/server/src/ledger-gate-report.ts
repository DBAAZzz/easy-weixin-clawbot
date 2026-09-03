/**
 * ledger-gate-report — canonical read-switch gate report (Phase 6 design §6).
 *
 * Aggregates the persisted evidence for one account and decides
 * `eligible_for_canonical`. Every gate input is queryable from the database:
 *
 * 1. invariants        — reconcileWeixinIngress (clear-boundary / zombie /
 *                        delivered-without-terminal-run) + orphan memory
 *                        supersede growth in the window;
 * 2. shadow convergence— context_compiler_shadow_results aggregation:
 *                        unclassified_difference = 0, legacy-only entry /
 *                        unresolved-attachment categories = 0, no
 *                        shadow_compile_failed;
 * 3. dual comparison   — runtime-only by design (dual products are never
 *                        persisted, §9): reported as a manual check;
 * 4. media coverage    — share of Phase-5 media messages with an artifact
 *                        mapping ≥ 99%;
 * 5. anchor coverage   — every trigger run in the window carries
 *                        run_started.payload.anchorStreamSeq (§7.2 — the
 *                        canonical switch must not rely on the local-clock
 *                        approximation).
 *
 * Usage: pnpm -F @clawbot/server ledger:gate -- --account <id> [--window-days 7]
 */

import { parseArgs } from "node:util";
import { reconcileWeixinIngress } from "./db/fact-ledger-reconciliation.js";
import { getPrisma } from "./db/prisma.js";
import { createModuleLogger, getErrorFields } from "./logger.js";

const logger = createModuleLogger("ledger-gate");

export interface GateCheck {
  check: string;
  mode: "automatic" | "manual";
  passed: boolean;
  detail: Record<string, unknown>;
}

export interface GateReport {
  accountId: string;
  windowDays: number;
  generatedAt: string;
  checks: GateCheck[];
  eligible_for_canonical: boolean;
}

export const MEDIA_COVERAGE_GATE = 0.99;

/** Orphan memory supersedes in the window: target event missing from the ledger. */
async function countOrphanSupersedes(
  prisma: ReturnType<typeof getPrisma>,
  accountId: string,
  since: Date,
): Promise<{ total: number; orphans: number }> {
  const supersedes = await prisma.memoryEvent.findMany({
    where: { accountId, eventType: "memory_superseded", recordedAt: { gte: since } },
    select: { eventId: true, payload: true },
  });
  const targetIds = [
    ...new Set(
      supersedes
        .map((event) => (event.payload as { targetMemoryEventId?: string }).targetMemoryEventId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const known = new Set(
    targetIds.length === 0
      ? []
      : (
          await prisma.memoryEvent.findMany({
            where: { accountId, eventId: { in: targetIds } },
            select: { eventId: true },
          })
        ).map((row) => row.eventId),
  );
  const orphanIds = new Set(
    supersedes
      .map((event) => (event.payload as { targetMemoryEventId?: string }).targetMemoryEventId)
      .filter((id): id is string => typeof id === "string" && !known.has(id)),
  );
  return { total: supersedes.length, orphans: orphanIds.size };
}

async function countMediaCoverage(
  prisma: ReturnType<typeof getPrisma>,
  accountId: string,
  since: Date,
): Promise<{ mediaMessages: number; mapped: number; coverage: number }> {
  const mediaEvents = await prisma.conversationEvent.findMany({
    where: {
      accountId,
      eventType: "inbound_message_received",
      occurredAt: { gte: since },
    },
    select: { payload: true },
  });
  const sourceRefs = mediaEvents
    .map((event) => (event.payload as { attachmentRefs?: string[] }).attachmentRefs ?? [])
    .flat();
  if (sourceRefs.length === 0) return { mediaMessages: 0, mapped: 0, coverage: 1 };
  const mappedCount = await prisma.conversationAttachmentArtifact.count({
    where: { accountId, sourceRef: { in: sourceRefs } },
  });
  return {
    mediaMessages: sourceRefs.length,
    mapped: mappedCount,
    coverage: mappedCount / sourceRefs.length,
  };
}

/** Trigger runs in the window missing the run_started anchor payload (§6.5). */
async function countTriggerRunsMissingAnchor(
  prisma: ReturnType<typeof getPrisma>,
  accountId: string,
  since: Date,
): Promise<{ triggerRuns: number; missingAnchor: number }> {
  const starts = await prisma.agentRunEvent.findMany({
    where: { accountId, eventType: "run_started", recordedAt: { gte: since } },
    select: { payload: true },
  });
  const triggerRuns = starts.filter(
    (event) => (event.payload as { triggerEventId?: string }).triggerEventId === undefined,
  );
  const missingAnchor = triggerRuns.filter(
    (event) =>
      typeof (event.payload as { anchorStreamSeq?: number }).anchorStreamSeq !== "number",
  ).length;
  return { triggerRuns: triggerRuns.length, missingAnchor };
}

export async function buildGateReport(
  accountId: string,
  options: { windowDays?: number } = {},
): Promise<GateReport> {
  const prisma = getPrisma();
  const windowDays = options.windowDays ?? 7;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const checks: GateCheck[] = [];

  // 1. Invariants.
  const reconciliation = await reconcileWeixinIngress(accountId);
  checks.push({
    check: "invariants",
    mode: "automatic",
    passed: reconciliation.summary.unexpected === 0 && reconciliation.summary.zombie_run === 0,
    detail: { summary: reconciliation.summary },
  });

  const supersedeWindow = await countOrphanSupersedes(prisma, accountId, since);
  checks.push({
    check: "memory_superseded_orphans",
    mode: "automatic",
    passed: supersedeWindow.orphans === 0,
    detail: supersedeWindow,
  });

  // 2. Shadow convergence (persisted per-turn results; shadow pins policy v2).
  const shadowRows = await prisma.contextCompilerShadowResult.findMany({
    where: { accountId, createdAt: { gte: since } },
    select: { diffCounts: true, status: true, errorCode: true },
  });
  const categoryTotals: Record<string, number> = {};
  let shadowFailed = 0;
  for (const row of shadowRows) {
    if (row.status === "failed") shadowFailed += 1;
    const counts = row.diffCounts as Record<string, number>;
    for (const [category, count] of Object.entries(counts)) {
      categoryTotals[category] = (categoryTotals[category] ?? 0) + (count ?? 0);
    }
  }
  const unclassified = categoryTotals["unclassified_difference"] ?? 0;
  const legacyOnly =
    (categoryTotals["legacy_only_assistant_entry"] ?? 0) +
    (categoryTotals["legacy_only_tool_entry"] ?? 0);
  const unresolved = categoryTotals["canonical_unresolved_attachment"] ?? 0;
  checks.push({
    check: "shadow_convergence",
    mode: "automatic",
    passed: unclassified === 0 && legacyOnly === 0 && unresolved === 0 && shadowFailed === 0,
    detail: {
      samples: shadowRows.length,
      unclassifiedDifference: unclassified,
      legacyOnlyEntries: legacyOnly,
      canonicalUnresolvedAttachment: unresolved,
      shadowCompileFailed: shadowFailed,
      categoryTotals,
    },
  });

  // 3. Dual comparison — runtime-only by design (§9: products never persisted).
  checks.push({
    check: "dual_diff_runtime",
    mode: "manual",
    passed: true,
    detail: {
      note:
        "context_dual_diff_total{result=different} is an in-process metric; verify near-zero " +
        "over a full business cycle from the running deployment before flipping read_path.",
    },
  });

  // 4. Media mapping coverage (§6.4).
  const media = await countMediaCoverage(prisma, accountId, since);
  checks.push({
    check: "media_mapping_coverage",
    mode: "automatic",
    passed: media.coverage >= MEDIA_COVERAGE_GATE,
    detail: { ...media, gate: MEDIA_COVERAGE_GATE },
  });

  // 5. Trigger-run anchor coverage (§6.5 / §7.2) — hard canonical gate.
  const anchors = await countTriggerRunsMissingAnchor(prisma, accountId, since);
  checks.push({
    check: "trigger_anchor_coverage",
    mode: "automatic",
    passed: anchors.missingAnchor === 0,
    detail: anchors,
  });

  return {
    accountId,
    windowDays,
    generatedAt: new Date().toISOString(),
    checks,
    eligible_for_canonical: checks.every((check) => check.passed),
  };
}

const isDirectRun = process.argv[1]?.endsWith("ledger-gate-report.ts");

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      "window-days": { type: "string", default: "7" },
    },
  });
  if (!values.account) {
    console.error("usage: ledger:gate -- --account <id> [--window-days 7]");
    return 2;
  }
  const report = await buildGateReport(values.account, {
    windowDays: Number(values["window-days"] ?? 7),
  });
  console.log(JSON.stringify(report, null, 2));
  return report.eligible_for_canonical ? 0 : 1;
}

if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      logger.error({ ...getErrorFields(error) }, "ledger gate report failed");
      process.exitCode = 2;
    });
}
