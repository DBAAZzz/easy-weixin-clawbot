import { createHash } from "node:crypto";

/**
 * Deterministic run-ledger identities (Phase 4 design §5.1/§5.4/§6.1/§9.1).
 *
 * Every id is derived from stable inputs so retries and settle-side writers
 * converge on the same value without passing state across process boundaries.
 * Parts are joined with NUL to prevent ambiguity from concatenation.
 */

function sha256Hex(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

/** `run-v1:<sha256(accountId + NUL + sourceEventId)>` — settle can re-derive it from the receipt alone. */
export function createRunId(accountId: string, sourceEventId: string): string {
  return `run-v1:${sha256Hex(accountId, sourceEventId)}`;
}

/** `call-v1:<sha256(runId + NUL + round)>` — one deterministic id per model call. */
export function createCallId(runId: string, round: number): string {
  return `call-v1:${sha256Hex(runId, String(round))}`;
}

/** `delivery-v1:<sha256(accountId + NUL + sourceEventId)>` — one delivery per chat reply. */
export function createDeliveryId(accountId: string, sourceEventId: string): string {
  return `delivery-v1:${sha256Hex(accountId, sourceEventId)}`;
}

/** `context-manifest-v1:<sha256(accountId + NUL + runId)>` — runId already guarantees uniqueness. */
export function createManifestId(accountId: string, runId: string): string {
  return `context-manifest-v1:${sha256Hex(accountId, runId)}`;
}

/**
 * `run-event-v1:<sha256(accountId + NUL + runId + NUL + kind + NUL + localKey)>`.
 *
 * Run Event v1 has no business idempotency key (Phase 1 §11.3); a deterministic
 * eventId gives retries the Store's id-retry semantics instead.
 */
export function createRunEventId(
  accountId: string,
  runId: string,
  kind: string,
  localKey: string,
): string {
  return `run-event-v1:${sha256Hex(accountId, runId, kind, localKey)}`;
}

/**
 * `outbound-v1:<sha256(accountId + NUL + sourceEventId + NUL + suffix)>` for
 * outbound conversation facts appended by the settle side.
 */
export function createOutboundFactEventId(
  accountId: string,
  sourceEventId: string,
  suffix: string,
): string {
  return `outbound-v1:${sha256Hex(accountId, sourceEventId, suffix)}`;
}

const STABLE_CODE_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,79}$/;

/**
 * Run event `error`/`reason` fields only carry stable codes, never raw
 * exception messages (they can contain prompt bodies or secrets). Errors with
 * an already-stable `code` pass through; everything else collapses to
 * `internal_error`.
 */
export function toStableErrorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    STABLE_CODE_PATTERN.test((error as { code: string }).code)
  ) {
    return (error as { code: string }).code;
  }
  return "internal_error";
}
