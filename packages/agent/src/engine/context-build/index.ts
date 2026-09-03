/**
 * Context build (Phase 6 design §8) — read-path dispatch over the three
 * `read_path` states: legacy (production default), dual (parallel canonical
 * build + hash comparison), canonical (model fed from the fact ledger).
 */

export { loadLegacyContext, type LegacyContext } from "./legacy.js";
export {
  buildCanonicalHistory,
  CanonicalContextBuildError,
  DEFAULT_MEDIA_REPLAY_LIMIT,
  type CanonicalHistoryBuild,
  type CanonicalHistoryBuildDeps,
} from "./canonical.js";
export {
  canonicalMessagesHash,
  compareDualHistories,
  type DualComparison,
  type DualDiffDimension,
} from "./dual.js";

export type ContextReadPath = "legacy" | "dual" | "canonical";
