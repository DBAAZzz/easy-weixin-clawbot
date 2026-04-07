/**
 * Tape reducer — folds entries into state.
 *
 * Core formula: CurrentState = Reducer(LastAnchor.Snapshot, NewEntries[])
 *
 * Merge strategies:
 * - fact / preference → last-write-wins (same key overwrites, keeps sourceEid for traceability)
 * - decision → append (decisions are timeline events, no dedup)
 * - summary → bulk merge (compact-produced aggregate entries)
 */

import type {
  SerializedTapeState,
  TapeDecision,
  TapeFact,
  TapePreference,
  TapeState,
} from "./types.js";

export function emptyState(): TapeState {
  return { facts: new Map(), preferences: new Map(), decisions: [], version: 0 };
}

interface FoldableEntry {
  eid: string;
  category: string;
  payload: { fragments?: Array<{ kind: string; data: Record<string, unknown> }> };
  createdAt: Date | string;
}

export function fold(state: TapeState, entry: FoldableEntry): TapeState {
  const next: TapeState = {
    facts: new Map(state.facts),
    preferences: new Map(state.preferences),
    decisions: [...state.decisions],
    version: state.version + 1,
  };

  const createdAt =
    entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : entry.createdAt;

  const fragments = entry.payload.fragments ?? [];

  switch (entry.category) {
    case "fact": {
      for (const f of fragments) {
        const key = f.data.key as string;
        if (!key) continue;
        next.facts.set(key, {
          key,
          value: f.data.value,
          confidence: (f.data.confidence as number) ?? 1,
          sourceEid: entry.eid,
          updatedAt: createdAt,
        });
      }
      break;
    }
    case "preference": {
      for (const f of fragments) {
        const key = f.data.key as string;
        if (!key) continue;
        next.preferences.set(key, {
          key,
          value: f.data.value,
          sourceEid: entry.eid,
          updatedAt: createdAt,
        });
      }
      break;
    }
    case "decision": {
      for (const f of fragments) {
        next.decisions.push({
          description: (f.data.description as string) ?? "",
          context: (f.data.context as string) ?? "",
          sourceEid: entry.eid,
          createdAt,
        });
      }
      break;
    }
    case "summary": {
      // Summary entries from compact carry pre-merged state fragments
      for (const f of fragments) {
        if (f.kind === "text" && f.data.facts) {
          const facts = f.data.facts as Record<string, TapeFact>;
          for (const [k, v] of Object.entries(facts)) {
            next.facts.set(k, v);
          }
        }
        if (f.kind === "text" && f.data.preferences) {
          const prefs = f.data.preferences as Record<string, TapePreference>;
          for (const [k, v] of Object.entries(prefs)) {
            next.preferences.set(k, v);
          }
        }
        if (f.kind === "text" && f.data.decisions) {
          const decs = f.data.decisions as TapeDecision[];
          next.decisions.push(...decs);
        }
      }
      break;
    }
  }

  return next;
}

/** Serialize TapeState for JSONB storage (Map → plain object) */
export function serializeState(state: TapeState): SerializedTapeState {
  return {
    facts: Object.fromEntries(state.facts),
    preferences: Object.fromEntries(state.preferences),
    decisions: state.decisions,
    version: state.version,
  };
}

/** Deserialize TapeState from JSONB (plain object → Map) */
export function deserializeState(json: unknown): TapeState {
  const raw = json as SerializedTapeState;
  return {
    facts: new Map(Object.entries(raw.facts ?? {})),
    preferences: new Map(Object.entries(raw.preferences ?? {})),
    decisions: raw.decisions ?? [],
    version: raw.version ?? 0,
  };
}
