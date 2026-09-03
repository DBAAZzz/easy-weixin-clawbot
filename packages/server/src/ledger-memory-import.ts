/**
 * ledger-memory-import — snapshot Tape memory state into the fact ledger
 * (Phase 7 design §7.1).
 *
 * For the global branch and every session branch with entries, the current
 * Tape projection (recall + serializeState) is stored as an immutable
 * MEMORY_SNAPSHOT artifact and referenced by a `memory_imported` event with
 * `reconstructability: "partial"`. The events-based memory projection uses the
 * newest such snapshot as its fold base, which covers the pre-Phase-5 gap and
 * trigger-run extractions that never produce ledger evidence.
 *
 * Idempotent: the artifactId and eventId are both content-addressed on the
 * snapshot, so an unchanged Tape state re-derives the same eventId and the
 * branch is reported as `skipped_imported` instead of being re-appended. The
 * check is an explicit `getById` probe rather than the store's id-retry
 * semantics: the payload carries `throughMemorySeq` (the branch event
 * watermark), which advances with every import — so a re-run would present the
 * same eventId with a *different* payload and id-retry would reject it as a
 * conflict. A later Tape change yields a different snapshot hash, hence a
 * different eventId, and is appended as a new event (fold takes the newest).
 *
 * Usage: pnpm -F @clawbot/server ledger:memory-import -- --account <id>
 *   [--branch <b>] [--dry-run]
 */

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import type { PrismaClient } from "@prisma/client";
import type {
  ArtifactRevisionStore,
  JsonValue,
  MemoryEventStore,
  TapeStore,
  TapeState,
} from "@clawbot/agent";
import {
  ARTIFACT_KIND,
  GLOBAL_BRANCH,
  getTapeStore,
  parseAppendMemoryEventInput,
  recall,
  serializeState,
  setTapeStore,
  sha256CanonicalJson,
} from "@clawbot/agent";
import { memoryImportTotal } from "@clawbot/observability";
import { PrismaArtifactRevisionStore } from "./db/artifact-revision-store.impl.js";
import { PrismaMemoryEventStore } from "./db/memory-event-store.impl.js";
import { PrismaTapeStore } from "./db/tape-store.impl.js";
import { getPrisma } from "./db/prisma.js";
import { createModuleLogger, getErrorFields } from "./logger.js";

const logger = createModuleLogger("ledger-memory-import");

/** Session branches without any entry are noise; cap the sweep explicitly. */
const MAX_BRANCHES_PER_RUN = 200;

export type MemoryImportResult =
  | { result: "appended"; eventId: string; snapshotArtifactId: string; throughMemorySeq: number }
  | { result: "dry_run"; eventId: string; snapshotArtifactId: string; throughMemorySeq: number }
  | { result: "skipped_imported" }
  | { result: "skipped_empty" }
  | { result: "failed"; reason: string };

export interface MemoryImportSummary {
  accountId: string;
  dryRun: boolean;
  branches: Array<{ branch: string } & MemoryImportResult>;
  failed: number;
}

function sha256Nul(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function isEmptyState(state: TapeState): boolean {
  return (
    state.facts.size === 0 && state.preferences.size === 0 && state.decisions.length === 0
  );
}

/**
 * Snapshot one branch's Tape state into a memory_imported event. See the
 * module doc for the idempotency and base-selection rules.
 */
export async function importMemoryBranch(input: {
  accountId: string;
  branch: string;
  dryRun: boolean;
  /** 测试注入；缺省用全局 Prisma 与端口实现。 */
  injectedPrisma?: PrismaClient;
  artifactRevisionStore?: ArtifactRevisionStore;
  memoryEventStore?: MemoryEventStore;
  /** recall() 走全局 TapeStore port；注入后立即挂载，缺省用 PrismaTapeStore。 */
  tapeStore?: TapeStore;
}): Promise<MemoryImportResult> {
  const { accountId, branch, dryRun } = input;
  const prisma = input.injectedPrisma ?? getPrisma();
  const artifactStore = input.artifactRevisionStore ?? new PrismaArtifactRevisionStore();
  const memoryEventStore = input.memoryEventStore ?? new PrismaMemoryEventStore();
  if (input.tapeStore) {
    setTapeStore(input.tapeStore);
  } else {
    // Keep an already-slotted store (tests / host process) when present.
    try {
      getTapeStore();
    } catch {
      setTapeStore(new PrismaTapeStore(prisma));
    }
  }

  try {
    const state = await recall(accountId, branch);
    if (isEmptyState(state)) {
      memoryImportTotal.inc({ result: "skipped_empty" });
      return { result: "skipped_empty" };
    }

    const snapshotDoc = { schemaVersion: 1, state: serializeState(state) };
    const snapshotSha = sha256CanonicalJson(snapshotDoc);
    const snapshotArtifactId = `memory-snapshot-v1:${snapshotSha}`;
    // SerializedTapeState is structurally JSON; the cast bridges the nominal
    // index-signature check for the artifact contract.
    const snapshotJson = snapshotDoc as unknown as JsonValue;

    const throughMemorySeq = await memoryEventStore.headSeq(accountId, branch);
    const eventId = `memory-import-v1:${sha256Nul(accountId, branch, snapshotSha)}`;

    // occurredAt must be deterministic for id-retry equivalence: the newest
    // Tape entry of the branch — "when the imported state was completed".
    const newestEntry = await prisma.tapeEntry.findFirst({
      where: { accountId, branch },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (!newestEntry) {
      memoryImportTotal.inc({ result: "skipped_empty" });
      return { result: "skipped_empty" };
    }
    const occurredAt = newestEntry.createdAt.toISOString();

    // Same snapshot content → same eventId → already imported. Probed rather
    // than left to id-retry because `throughMemorySeq` is not stable (see
    // module doc). Done before every write so `--dry-run` stays side-effect
    // free and reports the true outcome.
    if (await memoryEventStore.getById(eventId)) {
      memoryImportTotal.inc({ result: "skipped_imported" });
      return { result: "skipped_imported" };
    }

    const eventInput = parseAppendMemoryEventInput({
      eventId,
      eventType: "memory_imported",
      schemaVersion: 1,
      accountId,
      branch,
      occurredAt,
      actor: { kind: "agent", id: accountId },
      payload: {
        source: "tape_projection",
        reconstructability: "partial",
        snapshotArtifactId,
        throughMemorySeq,
      },
    });

    if (dryRun) {
      return { result: "dry_run", eventId, snapshotArtifactId, throughMemorySeq };
    }

    await artifactStore.put({
      artifactId: snapshotArtifactId,
      kind: ARTIFACT_KIND.MEMORY_SNAPSHOT,
      sha256: snapshotSha,
      schemaVersion: 1,
      inlineJson: snapshotJson,
    });

    const appended = await memoryEventStore.append(eventInput);
    if (!appended.appended) {
      // Same content hash + same occurredAt → idempotent re-run. A mismatched
      // payload with the same id throws FactLedgerIdConflictError instead.
      memoryImportTotal.inc({ result: "skipped_imported" });
      return { result: "skipped_imported" };
    }
    memoryImportTotal.inc({ result: "appended" });
    return { result: "appended", eventId, snapshotArtifactId, throughMemorySeq };
  } catch (error) {
    memoryImportTotal.inc({ result: "failed" });
    return { result: "failed", reason: (error as Error).message ?? "import_failed" };
  }
}

export async function runMemoryImport(options: {
  accountId: string;
  branch?: string;
  dryRun: boolean;
  injectedPrisma?: PrismaClient;
  tapeStore?: TapeStore;
}): Promise<MemoryImportSummary> {
  const { accountId, branch, dryRun } = options;
  const prisma = options.injectedPrisma ?? getPrisma();

  let branches: string[];
  if (branch) {
    branches = [branch];
  } else {
    const grouped = await prisma.tapeEntry.groupBy({
      by: ["branch"],
      where: { accountId },
      _count: { branch: true },
      orderBy: { branch: "asc" },
    });
    if (grouped.length > MAX_BRANCHES_PER_RUN) {
      throw new Error(
        `branch count ${grouped.length} exceeds the per-run cap ${MAX_BRANCHES_PER_RUN}; ` +
          "import with --branch in batches",
      );
    }
    // Global branch first so its base exists before session branches replay.
    branches = [
      ...grouped.map((row) => row.branch).filter((b) => b === GLOBAL_BRANCH),
      ...grouped.map((row) => row.branch).filter((b) => b !== GLOBAL_BRANCH),
    ];
    if (!branches.includes(GLOBAL_BRANCH)) branches.unshift(GLOBAL_BRANCH);
  }

  const results: MemoryImportSummary["branches"] = [];
  let failed = 0;
  for (const b of branches) {
    const result = await importMemoryBranch({
      accountId,
      branch: b,
      dryRun,
      injectedPrisma: options.injectedPrisma,
      tapeStore: options.tapeStore,
    });
    if (result.result === "failed") failed += 1;
    results.push({ branch: b, ...result });
  }

  return { accountId, dryRun, branches: results, failed };
}

// CLI entry — library callers import { runMemoryImport } instead.
if (process.argv[1] && process.argv[1].endsWith("ledger-memory-import.ts")) {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      branch: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const accountId = values.account;
  if (!accountId) {
    console.error("usage: ledger:memory-import --account <id> [--branch <b>] [--dry-run]");
    process.exit(2);
  }
  runMemoryImport({
    accountId,
    branch: values.branch,
    dryRun: values["dry-run"] ?? false,
  })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failed > 0) process.exit(1);
    })
    .catch((error) => {
      logger.error({ ...getErrorFields(error) }, "ledger:memory-import failed");
      process.exit(1);
    });
}
