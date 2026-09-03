/**
 * ledger-replay-audit — integrity audit of run artifacts (Phase 7 design §8).
 *
 * For every `run_completed` run of one account in the window, verify that the
 * chain needed to explain and rebuild the run is complete and intact:
 *
 * - every `model_call_started.requestArtifactId` (CANONICAL_REQUEST) exists
 *   and its recorded sha256 matches a recomputation over the content;
 * - every `model_call_completed.responseArtifactId` (MODEL_RESPONSE) likewise;
 * - the run's manifest (`context_compiled.payload.manifestId`, a
 *   CONTEXT_MANIFEST artifact) exists;
 * - `storageRef` artifacts are readable through the content sink.
 *
 * Missing artifacts are classified; `coverage_ratio < 1` exits non-zero. This
 * audits rebuildability — the rebuild itself is the production canonical read
 * path; manifest-pinned point-in-time replay remains future work (§3).
 *
 * Usage: pnpm -F @clawbot/server ledger:replay-audit -- --account <id>
 *   [--since <ISO>] [--until <ISO>]
 */

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { ARTIFACT_KIND, canonicalizeJson } from "@clawbot/agent";
import { replayAuditTotal } from "@clawbot/observability";
import { createLocalArtifactContentSink } from "./db/artifact-content-sink.js";
import { PrismaArtifactRevisionStore } from "./db/artifact-revision-store.impl.js";
import { getPrisma } from "./db/prisma.js";
import { FACT_LEDGER_ARTIFACTS_DIR } from "./paths.js";
import { createModuleLogger, getErrorFields } from "./logger.js";

const logger = createModuleLogger("ledger-replay-audit");

export type ReplayAuditFinding =
  | "ok"
  | "missing_request"
  | "missing_response"
  | "missing_manifest"
  | "hash_mismatch"
  | "sink_unreadable";

export interface ReplayAuditRunReport {
  runId: string;
  findings: ReplayAuditFinding[];
  checkedArtifacts: number;
}

export interface ReplayAuditReport {
  accountId: string;
  since: string;
  until: string;
  runsTotal: number;
  runsComplete: number;
  coverage_ratio: number;
  counts: Record<Exclude<ReplayAuditFinding, "ok">, number>;
  runs: ReplayAuditRunReport[];
}

type ArtifactLike = {
  artifactId: string;
  kind: string;
  sha256: string;
  inlineJson?: unknown;
  storageRef?: { provider: string; key: string };
};

/**
 * Re-verify one artifact's content hash. Inline documents hash canonically;
 * storage-backed content is the exact canonical JSON text (or raw media bytes)
 * the recorded digest was taken over.
 */
export async function verifyArtifact(
  artifact: ArtifactLike,
  sink: { get(key: string): Promise<Uint8Array | null> },
): Promise<Exclude<ReplayAuditFinding, "ok"> | undefined> {
  let contentBytes: Uint8Array;
  if (artifact.inlineJson !== undefined) {
    contentBytes = Buffer.from(canonicalizeJson(artifact.inlineJson), "utf8");
  } else if (artifact.storageRef) {
    const bytes = await sink.get(artifact.storageRef.key).catch(() => null);
    if (bytes === null) return "sink_unreadable";
    contentBytes = bytes;
  } else {
    return "hash_mismatch";
  }
  const digest = createHash("sha256").update(Buffer.from(contentBytes)).digest("hex");
  return digest === artifact.sha256 ? undefined : "hash_mismatch";
}

export async function runReplayAudit(options: {
  accountId: string;
  since: Date;
  until: Date;
}): Promise<ReplayAuditReport> {
  const { accountId, since, until } = options;
  // Resolved lazily so importing the module for verifyArtifact() does not
  // require a configured database.
  const prisma = getPrisma();
  const artifactStore = new PrismaArtifactRevisionStore();
  const sink = createLocalArtifactContentSink(FACT_LEDGER_ARTIFACTS_DIR);

  const runIds = await prisma.agentRunEvent.findMany({
    where: {
      accountId,
      eventType: "run_completed",
      recordedAt: { gte: since, lte: until },
    },
    select: { runId: true },
    orderBy: { recordedAt: "asc" },
  });

  const counts = {
    missing_request: 0,
    missing_response: 0,
    missing_manifest: 0,
    hash_mismatch: 0,
    sink_unreadable: 0,
  };
  const runs: ReplayAuditRunReport[] = [];

  for (const { runId } of runIds) {
    const events = await prisma.agentRunEvent.findMany({
      where: { accountId, runId },
      select: { eventType: true, payload: true },
    });

    const findings = new Set<ReplayAuditFinding>();
    let checkedArtifacts = 0;

    const verifyById = async (
      artifactId: string | undefined,
      finding: Exclude<ReplayAuditFinding, "ok">,
      expectedKind?: string,
    ): Promise<void> => {
      if (!artifactId) return;
      const artifact = await artifactStore.getById(artifactId).catch(() => null);
      if (!artifact || (expectedKind !== undefined && artifact.kind !== expectedKind)) {
        findings.add(finding);
        counts[finding] += 1;
        return;
      }
      checkedArtifacts += 1;
      const issue = await verifyArtifact(artifact as ArtifactLike, sink);
      if (issue) {
        findings.add(issue);
        counts[issue] += 1;
      }
    };

    for (const event of events) {
      const payload = event.payload as {
        requestArtifactId?: string;
        responseArtifactId?: string;
        manifestId?: string;
        finalResponseArtifactId?: string;
      };
      if (event.eventType === "model_call_started") {
        await verifyById(payload.requestArtifactId, "missing_request", ARTIFACT_KIND.CANONICAL_REQUEST);
      }
      if (event.eventType === "model_call_completed") {
        await verifyById(payload.responseArtifactId, "missing_response", ARTIFACT_KIND.MODEL_RESPONSE);
      }
      if (event.eventType === "run_completed") {
        await verifyById(payload.finalResponseArtifactId, "missing_response");
      }
      if (event.eventType === "context_compiled") {
        await verifyById(payload.manifestId, "missing_manifest", ARTIFACT_KIND.CONTEXT_MANIFEST);
      }
    }

    if (findings.size === 0) findings.add("ok");
    for (const finding of findings) replayAuditTotal.inc({ result: finding });
    runs.push({ runId, findings: [...findings], checkedArtifacts });
  }

  const runsTotal = runs.length;
  const runsComplete = runs.filter((run) => run.findings.length === 1 && run.findings[0] === "ok")
    .length;

  return {
    accountId,
    since: since.toISOString(),
    until: until.toISOString(),
    runsTotal,
    runsComplete,
    coverage_ratio: runsTotal === 0 ? 1 : runsComplete / runsTotal,
    counts,
    runs,
  };
}

// CLI entry — library callers import { runReplayAudit } instead.
if (process.argv[1] && process.argv[1].endsWith("ledger-replay-audit.ts")) {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
    },
  });
  const accountId = values.account;
  if (!accountId) {
    console.error("usage: ledger:replay-audit --account <id> [--since <ISO>] [--until <ISO>]");
    process.exit(2);
  }
  const until = values.until ? new Date(values.until) : new Date();
  const since = values.since
    ? new Date(values.since)
    : new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    console.error("invalid --since/--until timestamp");
    process.exit(2);
  }
  runReplayAudit({ accountId, since, until })
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
      if (report.coverage_ratio < 1) process.exit(1);
    })
    .catch((error) => {
      logger.error({ ...getErrorFields(error) }, "ledger:replay-audit failed");
      process.exit(1);
    });
}
