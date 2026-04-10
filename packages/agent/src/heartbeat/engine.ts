/**
 * Heartbeat Engine — polling tick + event-driven trigger.
 *
 * Concurrency model:
 *   Layer 1: inflight Set — same goal never runs twice concurrently
 *   Layer 2: per-account serial queue — same account's goals run serially
 *   Layer 3: withConversationLock — Phase 2 execution via HeartbeatExecutorPort (server layer)
 */

import { getHeartbeatStore } from "../ports/heartbeat-store.js";
import { getPushService } from "../ports/push-service.js";
import { evaluateGoal } from "./evaluator.js";
import type { GoalTransition } from "./types.js";
import { getHeartbeatExecutor } from "../ports/heartbeat-executor.js";

const TICK_INTERVAL_MS = 60_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;

/** Goals currently being evaluated — prevents same goal from running concurrently. */
const inflight = new Set<string>();

/** Per-account serial execution queue. */
const accountQueues = new Map<string, Promise<void>>();

function enqueueForAccount(accountId: string, fn: () => Promise<void>): void {
  const current = accountQueues.get(accountId) ?? Promise.resolve();
  const next = current
    .then(fn)
    .catch((err) => {
      console.error(`[heartbeat] account ${accountId} queue error:`, err);
    })
    .finally(() => {
      // Clean up empty queue references
      if (accountQueues.get(accountId) === next) {
        accountQueues.delete(accountId);
      }
    });
  accountQueues.set(accountId, next);
}

// ── Transition applicator ──────────────────────────────────────────

async function applyTransition(transition: GoalTransition): Promise<void> {
  const store = getHeartbeatStore();

  // 1. Write goal state
  await store.updateGoal(transition.goalId, transition.updates);

  // 2. Push notification (if requested and available)
  if (transition.requestPush) {
    try {
      const push = getPushService();
      await push.sendProactiveMessage(
        transition.requestPush.accountId,
        transition.requestPush.conversationId,
        transition.requestPush.text,
      );
    } catch (err) {
      // Push failure does NOT affect goal state
      console.warn(
        `[heartbeat] push failed for goal ${transition.goalId}: ${(err as Error).message}`,
      );
    }
  }
}

// ── Tick ────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  const store = getHeartbeatStore();
  const now = new Date();

  // 1. Expire overdue goals
  const abandonedCount = await store.abandonExpired(now);
  if (abandonedCount > 0) {
    console.log(`[heartbeat] abandoned ${abandonedCount} expired goal(s)`);
  }

  // 2. Process resume signals (waiting_user → pending where resumeSignal is set)
  const resumedCount = await store.processResumeSignals(now);
  if (resumedCount > 0) {
    console.log(`[heartbeat] resumed ${resumedCount} goal(s) from user replies`);
  }

  // 3. Find due goals
  const dueGoals = await store.findDueGoals(now);

  for (const goal of dueGoals) {
    if (inflight.has(goal.goalId)) continue;

    inflight.add(goal.goalId);
    enqueueForAccount(goal.accountId, async () => {
      try {
        const transition = await evaluateGoal(goal);
        await applyTransition(transition);
        console.log(
          `[heartbeat] goal ${goal.goalId} → ${transition.newStatus}` +
            (transition.updates.lastCheckResult
              ? ` (${transition.updates.lastCheckResult.slice(0, 80)})`
              : ""),
        );
      } catch (err) {
        console.error(`[heartbeat] unhandled error for goal ${goal.goalId}:`, err);
      } finally {
        inflight.delete(goal.goalId);
      }
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────

export function startHeartbeat(): void {
  if (tickTimer) return;

  tickTimer = setInterval(() => {
    tick().catch((err) => console.error("[heartbeat] tick error:", err));
  }, TICK_INTERVAL_MS);

  // unref so this timer doesn't prevent process exit
  tickTimer.unref?.();

  console.log(`[heartbeat] started, tick every ${TICK_INTERVAL_MS / 1000}s`);
}

export function stopHeartbeat(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log("[heartbeat] stopped");
  }
}

/**
 * Check for waiting_user goals after a user message in the source conversation.
 * Called from server/agent.ts post-chat hook.
 * Only writes events — does NOT immediately execute heartbeat.
 */
export async function checkWaitingGoalsAsync(
  accountId: string,
  conversationId: string,
  latestSeq: number,
): Promise<void> {
  const store = getHeartbeatStore();
  const waiting = await store.findByAccountAndStatus(accountId, conversationId, "waiting_user");

  if (waiting.length === 0) return;
  if (waiting.length > 1) {
    console.warn(
      `[heartbeat] ambiguous waiting_user resume skipped for ${accountId}/${conversationId}: ${waiting.length} active goals`,
    );
    return;
  }

  await store.markUserReplied(waiting[0].goalId, latestSeq);
}
