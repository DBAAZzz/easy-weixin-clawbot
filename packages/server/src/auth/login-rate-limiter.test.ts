import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLoginRateLimiter } from "./login-rate-limiter.js";

describe("login rate limiter", () => {
  it("allows attempts below the threshold", () => {
    const limiter = createLoginRateLimiter({ windowMs: 1000, maxAttempts: 3 });
    limiter.recordFailure("admin", 0);
    limiter.recordFailure("admin", 10);
    assert.equal(limiter.check("admin", 20), null);
  });

  it("locks out once the threshold is reached", () => {
    const limiter = createLoginRateLimiter({ windowMs: 1000, maxAttempts: 3 });
    limiter.recordFailure("admin", 0);
    limiter.recordFailure("admin", 10);
    limiter.recordFailure("admin", 20);
    assert.equal(limiter.check("admin", 30), 1);
  });

  it("reports remaining seconds rounded up", () => {
    const limiter = createLoginRateLimiter({ windowMs: 10_000, maxAttempts: 1 });
    limiter.recordFailure("admin", 0);
    assert.equal(limiter.check("admin", 2_500), 8);
  });

  it("expires the bucket once the window passes", () => {
    const limiter = createLoginRateLimiter({ windowMs: 1000, maxAttempts: 1 });
    limiter.recordFailure("admin", 0);
    assert.equal(limiter.check("admin", 500), 1);
    assert.equal(limiter.check("admin", 1000), null);
  });

  it("starts a fresh window after expiry rather than resuming the old count", () => {
    const limiter = createLoginRateLimiter({ windowMs: 1000, maxAttempts: 2 });
    limiter.recordFailure("admin", 0);
    limiter.recordFailure("admin", 100);
    assert.equal(limiter.check("admin", 200), 1);

    limiter.recordFailure("admin", 2000);
    assert.equal(limiter.check("admin", 2100), null);
  });

  it("clears the bucket on a successful login", () => {
    const limiter = createLoginRateLimiter({ windowMs: 1000, maxAttempts: 1 });
    limiter.recordFailure("admin", 0);
    assert.equal(limiter.check("admin", 100), 1);

    limiter.reset("admin");
    assert.equal(limiter.check("admin", 100), null);
  });

  it("tracks usernames independently", () => {
    const limiter = createLoginRateLimiter({ windowMs: 1000, maxAttempts: 1 });
    limiter.recordFailure("admin", 0);
    assert.equal(limiter.check("admin", 10), 1);
    assert.equal(limiter.check("operator", 10), null);
  });
});
