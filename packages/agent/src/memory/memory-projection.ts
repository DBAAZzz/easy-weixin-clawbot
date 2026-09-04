/**
 * Memory projection from Memory Events (Phase 7 design §7).
 *
 * Folds one branch's `memory_events` into a `TapeState` so prompt injection can
 * run without reading the Tape tables:
 *
 *     MemoryState = base(latest anchor/import snapshot) + fold(events after it)
 *
 * Base events (`memory_anchor_created`, `memory_imported`) reset the state to
 * their snapshot artifact's serialized TapeState; events at or below the base's
 * `throughMemorySeq` are already contained in the snapshot and are skipped.
 * Ordering authority is `memorySeq`, matching the store's branch sequence.
 *
 * Failures throw (`MemoryProjectionError`); the caller fail-opens to Tape
 * recall — this module never silently returns a degraded state.
 */

import type { ArtifactRevisionStore } from "../ports/artifact-revision-store.js";
import type { MemoryEventStore } from "../ports/memory-event-store.js";
import { MEMORY_EVENT_TYPE, type MemoryEvent } from "../shared/fact-ledger/contracts.js";
import { deserializeState, emptyState } from "./fold.js";
import type { TapeState } from "./types.js";

export type MemoryProjectionFailureCode =
  | "snapshot_artifact_missing"
  | "snapshot_unreadable"
  | "replay_failed";

export class MemoryProjectionError extends Error {
  override readonly name = "MemoryProjectionError";
  constructor(
    public readonly code: MemoryProjectionFailureCode,
    cause?: unknown,
  ) {
    super(`memory projection failed: ${code}`);
    if (cause !== undefined) this.cause = cause;
  }
}

const PAGE_SIZE = 500;

async function loadSnapshotState(
  store: ArtifactRevisionStore,
  snapshotArtifactId: string,
): Promise<TapeState> {
  let artifact;
  try {
    artifact = await store.getById(snapshotArtifactId);
  } catch (error) {
    throw new MemoryProjectionError("snapshot_artifact_missing", error);
  }
  if (!artifact || artifact.inlineJson === undefined) {
    throw new MemoryProjectionError("snapshot_artifact_missing");
  }
  const state = (artifact.inlineJson as { state?: unknown }).state;
  if (!state || typeof state !== "object") {
    throw new MemoryProjectionError("snapshot_unreadable");
  }
  try {
    return deserializeState(state);
  } catch (error) {
    throw new MemoryProjectionError("snapshot_unreadable", error);
  }
}

function decisionDescription(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function removeByEventId(state: TapeState, targetEventId: string): void {
  for (const [key, fact] of state.facts) {
    if (fact.sourceEid === targetEventId) state.facts.delete(key);
  }
  for (const [key, pref] of state.preferences) {
    if (pref.sourceEid === targetEventId) state.preferences.delete(key);
  }
  const kept = state.decisions.filter((decision) => decision.sourceEid !== targetEventId);
  if (kept.length !== state.decisions.length) state.decisions = kept;
}

interface AppliedAssertion {
  eventId: string;
  occurredAt: string;
  category: "fact" | "preference" | "decision";
  key: string;
  value: unknown;
  confidence?: number;
}

function applyAssertion(state: TapeState, assertion: AppliedAssertion): void {
  if (assertion.category === "decision") {
    state.decisions.push({
      description: decisionDescription(assertion.value),
      context: assertion.key,
      sourceEid: assertion.eventId,
      createdAt: assertion.occurredAt,
    });
    return;
  }
  if (assertion.category === "fact") {
    state.facts.set(assertion.key, {
      key: assertion.key,
      value: assertion.value,
      confidence: assertion.confidence ?? 1,
      sourceEid: assertion.eventId,
      updatedAt: assertion.occurredAt,
    });
  } else {
    state.preferences.set(assertion.key, {
      key: assertion.key,
      value: assertion.value,
      sourceEid: assertion.eventId,
      updatedAt: assertion.occurredAt,
    });
  }
}

async function loadAllBranchEvents(
  store: MemoryEventStore,
  accountId: string,
  branch: string,
): Promise<MemoryEvent[]> {
  const events: MemoryEvent[] = [];
  let afterSeq: number | undefined;
  while (true) {
    const page = await store.listBranch({
      accountId,
      branch,
      limit: PAGE_SIZE,
      ...(afterSeq !== undefined ? { afterSeq } : {}),
    });
    if (page.length === 0) break;
    events.push(...page);
    if (page.length < PAGE_SIZE) break;
    afterSeq = page.at(-1)!.memorySeq;
  }
  events.sort((left, right) => left.memorySeq - right.memorySeq);
  return events;
}

/**
 * Replay one branch's memory events into the current projected state.
 * See the module doc for the fold rules.
 */
export async function replayMemoryProjection(input: {
  accountId: string;
  branch: string;
  memoryEventStore: MemoryEventStore;
  artifactRevisionStore: ArtifactRevisionStore;
}): Promise<TapeState> {
  const { accountId, branch, memoryEventStore, artifactRevisionStore } = input;

  let events: MemoryEvent[];
  try {
    events = await loadAllBranchEvents(memoryEventStore, accountId, branch);
  } catch (error) {
    throw new MemoryProjectionError("replay_failed", error);
  }

  const state = emptyState();
  let floorSeq = 0;
  for (const event of events) {
    if (event.memorySeq <= floorSeq) continue;
    try {
      if (
        event.eventType === MEMORY_EVENT_TYPE.MEMORY_ANCHOR_CREATED ||
        event.eventType === MEMORY_EVENT_TYPE.MEMORY_IMPORTED
      ) {
        const payload = event.payload as {
          snapshotArtifactId: string;
          throughMemorySeq: number;
        };
        const base = await loadSnapshotState(artifactRevisionStore, payload.snapshotArtifactId);
        state.facts = base.facts;
        state.preferences = base.preferences;
        state.decisions = base.decisions;
        state.version = base.version;
        floorSeq = payload.throughMemorySeq;
        continue;
      }

      if (event.eventType === MEMORY_EVENT_TYPE.MEMORY_ASSERTED) {
        const payload = event.payload as unknown as AppliedAssertion;
        applyAssertion(state, {
          eventId: event.eventId,
          occurredAt: event.occurredAt,
          category: payload.category,
          key: payload.key,
          value: payload.value,
          ...(payload.category === "fact" ? { confidence: payload.confidence } : {}),
        });
        continue;
      }

      if (event.eventType === MEMORY_EVENT_TYPE.MEMORY_CORRECTED_BY_USER) {
        const payload = event.payload as unknown as {
          targetMemoryEventId: string;
          replacement: AppliedAssertion;
        };
        removeByEventId(state, payload.targetMemoryEventId);
        applyAssertion(state, {
          eventId: event.eventId,
          occurredAt: event.occurredAt,
          category: payload.replacement.category,
          key: payload.replacement.key,
          value: payload.replacement.value,
          ...(payload.replacement.category === "fact"
            ? { confidence: payload.replacement.confidence }
            : {}),
        });
        continue;
      }

      if (
        event.eventType === MEMORY_EVENT_TYPE.MEMORY_SUPERSEDED ||
        event.eventType === MEMORY_EVENT_TYPE.MEMORY_RETRACTED
      ) {
        const payload = event.payload as { targetMemoryEventId: string };
        // Supersede: the replacement arrives as its own asserted event and
        // applies through the normal path — here we only drop the target when
        // it is still the live state holder. Retract: drop, nothing replaces.
        removeByEventId(state, payload.targetMemoryEventId);
        continue;
      }
    } catch (error) {
      if (error instanceof MemoryProjectionError) throw error;
      throw new MemoryProjectionError("replay_failed", error);
    }
  }
  return state;
}
