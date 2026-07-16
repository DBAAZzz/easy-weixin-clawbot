const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

type Bucket = {
  failures: number;
  firstFailureAt: number;
};

export interface LoginRateLimiter {
  /** Returns the seconds to wait when the caller is locked out, otherwise null. */
  check(key: string, now?: number): number | null;
  recordFailure(key: string, now?: number): void;
  reset(key: string): void;
}

/**
 * Per-username login throttle.
 *
 * Keyed on username rather than client IP on purpose: the IP reaching this
 * process is either a spoofable `X-Forwarded-For` value or a single reverse
 * proxy address, so neither bounds an attacker. A username bucket cannot be
 * rotated around. Lockout is a bounded window (not permanent) and any
 * successful login clears it, so it cannot be used to lock an admin out for
 * longer than the window.
 */
export function createLoginRateLimiter(
  { windowMs = WINDOW_MS, maxAttempts = MAX_ATTEMPTS } = {},
): LoginRateLimiter {
  const buckets = new Map<string, Bucket>();

  function currentBucket(key: string, now: number): Bucket | undefined {
    const bucket = buckets.get(key);
    if (!bucket) return undefined;

    if (now - bucket.firstFailureAt >= windowMs) {
      buckets.delete(key);
      return undefined;
    }

    return bucket;
  }

  return {
    check(key, now = Date.now()) {
      const bucket = currentBucket(key, now);
      if (!bucket || bucket.failures < maxAttempts) {
        return null;
      }

      const retryAfterMs = bucket.firstFailureAt + windowMs - now;
      return Math.max(1, Math.ceil(retryAfterMs / 1000));
    },

    recordFailure(key, now = Date.now()) {
      const bucket = currentBucket(key, now);
      if (!bucket) {
        buckets.set(key, { failures: 1, firstFailureAt: now });
        return;
      }

      bucket.failures += 1;
    },

    reset(key) {
      buckets.delete(key);
    },
  };
}
