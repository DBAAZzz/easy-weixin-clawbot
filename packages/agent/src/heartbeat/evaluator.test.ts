import assert from "node:assert/strict";
import test from "node:test";
import { pendingWithBackoff } from "./evaluator.js";
import type { PendingGoalRow } from "./types.js";

function createGoal(overrides: Partial<PendingGoalRow> = {}): PendingGoalRow {
  const now = new Date("2026-06-20T00:00:00.000Z");
  return {
    id: 1n,
    goalId: "goal-1",
    accountId: "account-1",
    sourceConversationId: "conversation-1",
    description: "follow up",
    context: "context",
    originType: "conversation",
    originRef: null,
    status: "pending",
    nextCheckAt: now,
    checkCount: 2,
    maxChecks: 10,
    backoffMs: 5_000,
    latestSourceMessageSeq: null,
    resumeSignal: "user replied",
    lastCheckAt: null,
    lastCheckResult: null,
    resolution: null,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    ...overrides,
  };
}

test("pendingWithBackoff increments counters, clears resume signal, and schedules next check", () => {
  const now = new Date("2026-06-20T01:00:00.000Z");
  const transition = pendingWithBackoff(
    createGoal(),
    now,
    "wait",
    { totalInputTokens: 120, totalOutputTokens: 70 },
  );

  assert.equal(transition.goalId, "goal-1");
  assert.equal(transition.newStatus, "pending");
  assert.equal(transition.updates.status, "pending");
  assert.equal(transition.updates.lastCheckAt, now);
  assert.equal(transition.updates.lastCheckResult, "wait");
  assert.equal(transition.updates.checkCount, 3);
  assert.equal(transition.updates.backoffMs, 15_000);
  assert.deepEqual(transition.updates.nextCheckAt, new Date("2026-06-20T01:00:15.000Z"));
  assert.equal(transition.updates.resumeSignal, null);
  assert.equal(transition.updates.totalInputTokens, 120);
  assert.equal(transition.updates.totalOutputTokens, 70);
});

test("pendingWithBackoff omits token updates when usage is unavailable", () => {
  const transition = pendingWithBackoff(createGoal(), new Date("2026-06-20T01:00:00.000Z"), "error");

  assert.equal("totalInputTokens" in transition.updates, false);
  assert.equal("totalOutputTokens" in transition.updates, false);
});
