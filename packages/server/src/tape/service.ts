/**
 * Tape service — record / recall / compact / handoff / purge
 *
 * All write operations are expected to run inside withConversationLock()
 * (or the __global__ branch lock), guaranteeing branch-level serialization.
 */

import type { Prisma } from "@prisma/client";
import { getPrisma } from "../db/prisma.js";
import { deserializeState, emptyState, fold, serializeState } from "./fold.js";
import type { RecordParams, TapeState } from "./types.js";

// ── record ──────────────────────────────────────────────────────────

export async function record(
  accountId: string,
  branch: string,
  params: RecordParams,
): Promise<string> {
  const prisma = getPrisma();
  const entry = await prisma.tapeEntry.create({
    data: {
      accountId,
      branch,
      type: "record",
      category: params.category,
      payload: params.payload as unknown as Prisma.InputJsonValue,
      actor: params.actor,
      source: params.source ?? null,
    },
  });
  return entry.eid;
}

// ─��� recall ──────────────────────────────────────────────────────────

export async function recall(
  accountId: string,
  branch: string,
): Promise<TapeState> {
  const prisma = getPrisma();

  // 1. Find the latest anchor for this branch
  const anchor = await prisma.tapeAnchor.findFirst({
    where: { accountId, branch },
    orderBy: { createdAt: "desc" },
  });

  // 2. Read incremental entries after the anchor
  const incremental = await prisma.tapeEntry.findMany({
    where: {
      accountId,
      branch,
      compacted: false,
      ...(anchor?.lastEntryEid
        ? { createdAt: { gt: anchor.createdAt } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  // 3. Fold: anchor snapshot + incremental entries → current state
  const baseState = anchor
    ? deserializeState(anchor.snapshot)
    : emptyState();

  return incremental.reduce(
    (state, entry) =>
      fold(state, {
        eid: entry.eid,
        category: entry.category,
        payload: entry.payload as { fragments?: Array<{ kind: string; data: Record<string, unknown> }> },
        createdAt: entry.createdAt,
      }),
    baseState,
  );
}

// ── compact ────��────────────────────────────────────────────────────

export async function compactIfNeeded(
  accountId: string,
  branch: string,
  threshold = 200,
): Promise<boolean> {
  const prisma = getPrisma();

  const latestAnchor = await prisma.tapeAnchor.findFirst({
    where: { accountId, branch },
    orderBy: { createdAt: "desc" },
  });

  const entries = await prisma.tapeEntry.findMany({
    where: {
      accountId,
      branch,
      compacted: false,
      ...(latestAnchor ? { createdAt: { gt: latestAnchor.createdAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length < threshold) return false;

  // Fold all entries to get current state
  const currentState = await recall(accountId, branch);
  const entryEids = entries.map((e) => e.eid);
  const lastEntry = entries[entries.length - 1];

  await prisma.$transaction(async (tx) => {
    // 1. Create checkpoint anchor
    await tx.tapeAnchor.create({
      data: {
        accountId,
        branch,
        anchorType: "checkpoint",
        snapshot: serializeState(currentState) as unknown as Prisma.InputJsonValue,
        manifest: entryEids,
        predecessors: latestAnchor ? [latestAnchor.aid] : [],
        lastEntryEid: lastEntry.eid,
      },
    });

    // 2. Mark old entries as compacted
    await tx.tapeEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { compacted: true },
    });
  });

  return true;
}

// ── handoff (for /reset session rotation) ───────────────────────────

/**
 * Filter state for handoff: keep persistent preferences and key facts,
 * drop session-specific context and low-confidence facts.
 */
function filterForHandoff(state: TapeState): TapeState {
  const filtered = emptyState();

  // Keep all preferences (persistent by nature)
  filtered.preferences = new Map(state.preferences);

  // Keep high-confidence facts only
  for (const [key, fact] of state.facts) {
    if (fact.confidence >= 0.8) {
      filtered.facts.set(key, fact);
    }
  }

  // Keep only the last 20 decisions (trim old context)
  filtered.decisions = state.decisions.slice(-20);
  filtered.version = state.version;

  return filtered;
}

function extractKeyEntryEids(state: TapeState): string[] {
  const eids = new Set<string>();
  for (const fact of state.facts.values()) eids.add(fact.sourceEid);
  for (const pref of state.preferences.values()) eids.add(pref.sourceEid);
  for (const dec of state.decisions) eids.add(dec.sourceEid);
  return [...eids];
}

export async function createHandoffAnchors(
  accountId: string,
  oldBranch: string,
  newBranch: string,
): Promise<void> {
  const prisma = getPrisma();
  const oldState = await recall(accountId, oldBranch);
  const handoffSnapshot = filterForHandoff(oldState);

  // Skip handoff if there's nothing to carry over
  if (
    handoffSnapshot.facts.size === 0 &&
    handoffSnapshot.preferences.size === 0 &&
    handoffSnapshot.decisions.length === 0
  ) {
    return;
  }

  const serialized = serializeState(handoffSnapshot) as unknown as Prisma.InputJsonValue;
  const manifest = extractKeyEntryEids(handoffSnapshot);

  // 1. Create handoff anchor on old branch
  const oldAnchor = await prisma.tapeAnchor.create({
    data: {
      accountId,
      branch: oldBranch,
      anchorType: "handoff",
      snapshot: serialized,
      manifest,
    },
  });

  // 2. Create handoff anchor on new branch (predecessors → old branch)
  await prisma.tapeAnchor.create({
    data: {
      accountId,
      branch: newBranch,
      anchorType: "handoff",
      snapshot: serialized,
      predecessors: [oldAnchor.aid],
    },
  });
}

// ── purge ──────────���────────────────────────────────────────────────

export async function purgeCompacted(retentionDays = 30): Promise<number> {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await prisma.tapeEntry.deleteMany({
    where: {
      compacted: true,
      createdAt: { lt: cutoff },
    },
  });

  return result.count;
}

// ── format for prompt injection ─���───────────────────────────────────

export function formatMemoryForPrompt(
  globalMemory: TapeState,
  sessionMemory: TapeState,
): string {
  const sections: string[] = [];

  // Global facts
  if (globalMemory.facts.size > 0 || sessionMemory.facts.size > 0) {
    const allFacts = new Map([...globalMemory.facts, ...sessionMemory.facts]);
    if (allFacts.size > 0) {
      const lines = [...allFacts.values()].map(
        (f) => `- ${f.key}: ${JSON.stringify(f.value)}`,
      );
      sections.push(`## 已知事实\n${lines.join("\n")}`);
    }
  }

  // Preferences
  if (globalMemory.preferences.size > 0 || sessionMemory.preferences.size > 0) {
    const allPrefs = new Map([...globalMemory.preferences, ...sessionMemory.preferences]);
    if (allPrefs.size > 0) {
      const lines = [...allPrefs.values()].map(
        (p) => `- ${p.key}: ${JSON.stringify(p.value)}`,
      );
      sections.push(`## 用户偏好\n${lines.join("\n")}`);
    }
  }

  // Recent decisions (session only, last 5)
  const recentDecisions = sessionMemory.decisions.slice(-5);
  if (recentDecisions.length > 0) {
    const lines = recentDecisions.map(
      (d) => `- ${d.description}${d.context ? ` (${d.context})` : ""}`,
    );
    sections.push(`## 近期决策\n${lines.join("\n")}`);
  }

  if (sections.length === 0) return "";
  return `<memory>\n${sections.join("\n\n")}\n</memory>`;
}
