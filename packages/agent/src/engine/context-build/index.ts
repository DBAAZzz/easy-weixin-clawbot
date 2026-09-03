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

/**
 * Phase 7：记忆注入读取三态（design §7.3）。`tape` 为 Phase 0–6 行为；
 * `events` 从 memory events 重放投影；`dual` 双跑对比但仍注入 Tape。
 */
export type MemoryReadPath = "tape" | "dual" | "events";
