/**
 * Tape service — record / recall / compact / handoff / purge
 *
 * All DB operations go through the TapeStore port interface.
 */

import { estimateTextTokens } from "../llm/token-estimator.js";
import { getTapeStore } from "../ports/tape-store.js";
import { deserializeState, emptyState, fold, serializeState } from "./fold.js";
import type { RecordParams, TapeState } from "./types.js";

/**
 * Decisions kept in a checkpoint snapshot. Decisions are append-only timeline
 * events, so without a bound a long-lived branch grows its snapshot forever.
 *
 * Facts and preferences are deliberately NOT filtered here: their source
 * entries are marked compacted and eventually purged, so dropping one from the
 * snapshot deletes it permanently. That is acceptable for a handoff (an
 * explicit, lossy session rotation) but not for a checkpoint.
 */
const CHECKPOINT_DECISION_LIMIT = 50;

/** Decisions carried across a `/reset` handoff. */
const HANDOFF_DECISION_LIMIT = 20;

/** Session decisions injected into the prompt. */
const PROMPT_DECISION_LIMIT = 5;

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

/**
 * Bound the decision timeline for a checkpoint snapshot, leaving facts and
 * preferences untouched. See {@link CHECKPOINT_DECISION_LIMIT}.
 */
export function withBoundedDecisions(state: TapeState): TapeState {
  if (state.decisions.length <= CHECKPOINT_DECISION_LIMIT) return state;
  return { ...state, decisions: state.decisions.slice(-CHECKPOINT_DECISION_LIMIT) };
}

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
      snapshot: serializeState(withBoundedDecisions(currentState)),
      manifest: entryEids,
      predecessors: latestAnchor ? [latestAnchor.aid] : [],
      lastEntryEid: lastEntry.eid,
    },
    // entryEids are strings; the store implementation accepts bigint[] (DB IDs).
    // We let the store impl handle the conversion at the boundary.
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

  // Keep only the most recent decisions (trim old context)
  filtered.decisions = state.decisions.slice(-HANDOFF_DECISION_LIMIT);
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

/**
 * Token ceiling for the whole `<memory>` block.
 *
 * Memory is injected on *every* turn, so an unbounded block silently taxes each
 * message for the life of the account. Typical memories sit far below this;
 * the budget exists to bound the tail, not to shape normal output.
 */
const DEFAULT_MEMORY_TOKEN_BUDGET = 1000;

export interface MemoryPromptOptions {
  /** Token ceiling for the rendered block. Pass Infinity to disable trimming. */
  maxTokens?: number;
}

interface BudgetedLine {
  line: string;
  /** Higher survives trimming first. Ties broken by original order. */
  rank: string;
}

function lineCost(line: string): number {
  // +1 for the newline joining it to the previous line.
  return estimateTextTokens(line) + 1;
}

/**
 * Greedily keep the highest-ranked lines that fit, then restore original order.
 *
 * Selection is by rank (recency) but rendering is by original order, so a memory
 * that fits the budget is byte-identical to an unbudgeted render.
 */
function takeWithinBudget(
  entries: BudgetedLine[],
  budget: number,
): { lines: string[]; dropped: number; spent: number } {
  const total = entries.reduce((sum, entry) => sum + lineCost(entry.line), 0);
  if (total <= budget) {
    return { lines: entries.map((entry) => entry.line), dropped: 0, spent: total };
  }

  const byRank = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) =>
      a.entry.rank === b.entry.rank
        ? b.index - a.index
        : a.entry.rank < b.entry.rank
          ? 1
          : -1,
    );

  const keptIndexes = new Set<number>();
  let spent = 0;

  for (const { entry, index } of byRank) {
    const cost = lineCost(entry.line);
    if (spent + cost > budget) continue;
    spent += cost;
    keptIndexes.add(index);
  }

  return {
    lines: entries.filter((_, index) => keptIndexes.has(index)).map((entry) => entry.line),
    dropped: entries.length - keptIndexes.size,
    spent,
  };
}

export function formatMemoryForPrompt(
  globalMemory: TapeState,
  sessionMemory: TapeState,
  options: MemoryPromptOptions = {},
): string {
  const sections: string[] = [];
  const budget = options.maxTokens ?? DEFAULT_MEMORY_TOKEN_BUDGET;
  // `<memory>` wrapper plus the per-section headers we may emit.
  let remaining = budget - estimateTextTokens("<memory>\n</memory>\n## 已知事实\n## 用户偏好\n## 近期决策");
  let dropped = 0;

  // Preferences claim the budget first: they are few, long-lived, and shape
  // every reply. Facts come next by recency, decisions last.
  if (globalMemory.preferences.size > 0 || sessionMemory.preferences.size > 0) {
    const allPrefs = new Map([...globalMemory.preferences, ...sessionMemory.preferences]);
    if (allPrefs.size > 0) {
      const taken = takeWithinBudget(
        [...allPrefs.values()].map((p) => ({
          line: `- ${p.key}: ${JSON.stringify(p.value)}`,
          rank: p.updatedAt,
        })),
        remaining,
      );
      remaining -= taken.spent;
      dropped += taken.dropped;
      if (taken.lines.length > 0) {
        sections.push(`## 用户偏好\n${taken.lines.join("\n")}`);
      }
    }
  }

  if (globalMemory.facts.size > 0 || sessionMemory.facts.size > 0) {
    const allFacts = new Map([...globalMemory.facts, ...sessionMemory.facts]);
    if (allFacts.size > 0) {
      const taken = takeWithinBudget(
        [...allFacts.values()].map((f) => ({
          line: `- ${f.key}: ${JSON.stringify(f.value)}`,
          rank: f.updatedAt,
        })),
        remaining,
      );
      remaining -= taken.spent;
      dropped += taken.dropped;
      if (taken.lines.length > 0) {
        sections.unshift(`## 已知事实\n${taken.lines.join("\n")}`);
      }
    }
  }

  // Recent decisions (session only)
  const recentDecisions = sessionMemory.decisions.slice(-PROMPT_DECISION_LIMIT);
  if (recentDecisions.length > 0) {
    const taken = takeWithinBudget(
      recentDecisions.map((d, index) => ({
        line: `- ${d.description}${d.context ? ` (${d.context})` : ""}`,
        rank: String(index).padStart(4, "0"),
      })),
      remaining,
    );
    dropped += taken.dropped;
    if (taken.lines.length > 0) {
      sections.push(`## 近期决策\n${taken.lines.join("\n")}`);
    }
  }

  if (sections.length === 0) return "";

  // Tell the model its memory is incomplete. Without this it reads "not
  // mentioned" as "does not exist" and answers with false confidence.
  if (dropped > 0) {
    sections.push(`（记忆超出预算，已省略 ${dropped} 条较早内容）`);
  }

  return `<memory>\n${sections.join("\n\n")}\n</memory>`;
}
