import { createHash } from "node:crypto";

/**
 * Deterministic settle-side identities shared across layers (Phase 6 §5.2).
 *
 * These are pure hash derivations with no engine dependencies, so capability
 * modules (L4) can import them from shared without an upward engine edge.
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

/** `delivery-v1:<sha256(accountId + NUL + sourceEventId)>` — one delivery per chat reply. */
export function createDeliveryId(accountId: string, sourceEventId: string): string {
  return `delivery-v1:${sha256Hex(accountId, sourceEventId)}`;
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
