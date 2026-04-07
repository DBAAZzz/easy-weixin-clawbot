/**
 * Tape service — record / recall / compact / handoff / purge
 *
 * All DB operations go through the TapeStore port interface.
 */

import { getTapeStore } from "../ports/tape-store.js";
import { deserializeState, emptyState, fold, serializeState } from "./fold.js";
import type { RecordParams, TapeState } from "./types.js";

// ── record ──────────────────────────────────────────────────────────

export async function record(
  accountId: string,
  branch: string,
  params: RecordParams,
): Promise<string> {
  const store = getTapeStore();
  return store.createEntry({
    accountId,
    branch,
    type: "record",
    category: params.category,
    payload: params.payload,
    actor: params.actor,
    source: params.source ?? null,
  });
}

// ── recall ──────────────────────────────────────────────────────────

export async function recall(
  accountId: string,
  branch: string,
): Promise<TapeState> {
  const store = getTapeStore();

  // 1. Find the latest anchor for this branch
  const anchor = await store.findLatestAnchor(accountId, branch);

  // 2. Read incremental entries after the anchor
  const incremental = await store.findEntries(
    accountId,
    branch,
    anchor?.createdAt ?? undefined,
  );

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

// ── compact ─────────────────────────────────────────────────────────

export async function compactIfNeeded(
  accountId: string,
  branch: string,
  threshold = 200,
): Promise<boolean> {
  const store = getTapeStore();

  const latestAnchor = await store.findLatestAnchor(accountId, branch);

  const entries = await store.findEntries(
    accountId,
    branch,
    latestAnchor?.createdAt ?? undefined,
  );

  if (entries.length < threshold) return false;

  // Fold all entries to get current state
  const currentState = await recall(accountId, branch);
  const entryEids = entries.map((e) => e.eid);
  const lastEntry = entries[entries.length - 1];

  await store.compactTransaction(
    {
      accountId,
      branch,
      anchorType: "checkpoint",
      snapshot: serializeState(currentState),
      manifest: entryEids,
      predecessors: latestAnchor ? [latestAnchor.aid] : [],
      lastEntryEid: lastEntry.eid,
    },
    // We pass eids and let the store impl handle the bigint conversion
    entryEids as unknown as bigint[],
  );

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
  const store = getTapeStore();
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

  const serialized = serializeState(handoffSnapshot);
  const manifest = extractKeyEntryEids(handoffSnapshot);

  // 1. Create handoff anchor on old branch
  const oldAnchorAid = await store.createAnchor({
    accountId,
    branch: oldBranch,
    anchorType: "handoff",
    snapshot: serialized,
    manifest,
  });

  // 2. Create handoff anchor on new branch (predecessors → old branch)
  await store.createAnchor({
    accountId,
    branch: newBranch,
    anchorType: "handoff",
    snapshot: serialized,
    predecessors: [oldAnchorAid],
  });
}

// ── purge ─────────────────────────────────────────────────────────

export async function purgeCompacted(retentionDays = 30): Promise<number> {
  const store = getTapeStore();
  return store.purgeCompacted(retentionDays);
}

// ── format for prompt injection ───────────────────────────────────

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
