/**
 * Projection write mode resolver (Phase 7 design §6).
 *
 * `messages` is a Web UI projection, not the agent's history source. The mode
 * decides what the turn pipeline persists there:
 *
 * - `prompt_shaped` — Phase 0–6 behaviour verbatim (assembled user text +
 *   visualContext sidecar). Default so every existing account and test is
 *   untouched.
 * - `clean` — user messages persist as the *original* user text plus image
 *   blocks; the assembled text and visualContext sidecar never reach the
 *   payload. The in-memory history keeps the assembled message (legacy read
 *   paths need it); only the persisted projection changes shape.
 * - `suspended` — persist nothing; the live history array, rollback and seq
 *   counters keep working so re-enabling cannot collide on seq.
 *
 * The server wires a resolver from the per-account rollout snapshot at account
 * start; `clean` is only meaningful with `read_path = canonical` (enforced at
 * the wiring layer, not here).
 */

export type ProjectionWriteMode = "prompt_shaped" | "clean" | "suspended";

const DEFAULT_MODE: ProjectionWriteMode = "prompt_shaped";

type ProjectionWriteModeResolver = (accountId: string) => ProjectionWriteMode;

let resolver: ProjectionWriteModeResolver = () => DEFAULT_MODE;

export function setProjectionWriteModeResolver(next: ProjectionWriteModeResolver): void {
  resolver = next;
}

export function resetProjectionWriteModeResolver(): void {
  resolver = () => DEFAULT_MODE;
}

/** Resolve the mode for one account; a faulty resolver degrades to the default. */
export function projectionWriteModeFor(accountId: string): ProjectionWriteMode {
  try {
    return resolver(accountId) ?? DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}
