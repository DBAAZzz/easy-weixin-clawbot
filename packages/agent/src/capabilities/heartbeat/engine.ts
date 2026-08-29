/**
 * Heartbeat Engine — the agent's proactive pulse.
 *
 * Once a minute it finds conversations due for self-reflection and asks the
 * agent, given only its memory and how long things have been quiet, whether
 * there is anything worth saying right now. Nothing is scheduled in advance:
 * both the decision and the words are produced at that moment.
 *
 * Concurrency:
 *   claimForEval is an optimistic UPDATE — only the worker that moves
 *   nextEvalAt forward proceeds, which holds across processes.
 *   A per-account queue keeps one person from receiving two at once.
 */

import { createLogger } from "@clawbot/observability";
import { getHeartbeatStore } from "../../ports/heartbeat-store.js";
import { getPushService } from "../../ports/push-service.js";
import { getChatExecutor } from "../../ports/chat-executor.js";
import { evaluatePulse, applyPulseGuards, localDateKey } from "./evaluator.js";
import {
  type PulseRow,
  type PulseUpdate,
  type PulseVerdict,
  PULSE_TICK_BATCH_SIZE,
  PULSE_MIN_MINUTES,
  PULSE_PARSE_FAILURE_MINUTES,
} from "./types.js";

const logger = createLogger({ component: "heartbeat.engine" });

const TICK_INTERVAL_MS = 60_000;
const MINUTE_MS = 60_000;

let tickTimer: ReturnType<typeof setInterval> | null = null;

/** Per-account serial execution queue. */
const accountQueues = new Map<string, Promise<void>>();

function enqueueForAccount(accountId: string, fn: () => Promise<void>): void {
  const current = accountQueues.get(accountId) ?? Promise.resolve();
  const next = current
    .then(fn)
    .catch((err) => {
      logger.error("account queue error", { accountId, error: err });
    })
    .finally(() => {
      if (accountQueues.get(accountId) === next) {
        accountQueues.delete(accountId);
      }
    });
  accountQueues.set(accountId, next);
}

/**
 * Say something in the user's real conversation.
 *
 * The prompt is an instruction to the agent, not the message itself — chat()
 * composes the actual words with full history and tools available.
 */
async function speak(pulse: PulseRow, prompt: string): Promise<boolean> {
  const result = await getChatExecutor().execute({
    accountId: pulse.accountId,
    conversationId: pulse.conversationId,
    prompt,
    runKind: "heartbeat",
    inputRole: "trigger",
    triggerMeta: { kind: "pulse" },
  });

  if (result.status === "error") {
    logger.warn("pulse chat failed", {
      accountId: pulse.accountId,
      conversationId: pulse.conversationId,
      error: result.error,
    });
    return false;
  }

  const text = result.text?.trim();
  if (!text) {
    logger.warn("pulse produced no text", {
      accountId: pulse.accountId,
      conversationId: pulse.conversationId,
    });
    return false;
  }

  try {
    // chat() already persisted the assistant message in this conversation;
    // recordHistory: false stops the push from writing it a second time.
    await getPushService().sendProactiveMessage(
      pulse.accountId,
      pulse.conversationId,
      text,
      { recordHistory: false },
    );
    return true;
  } catch (err) {
    logger.warn("pulse push failed", {
      accountId: pulse.accountId,
      conversationId: pulse.conversationId,
      error: err,
    });
    return false;
  }
}

/** Asks whether to speak. Injectable so tests can drive the loop without an LLM. */
export type PulseEvaluator = (pulse: PulseRow, now: Date) => Promise<PulseVerdict>;

async function evaluateOne(
  pulse: PulseRow,
  now: Date,
  evaluate: PulseEvaluator,
): Promise<void> {
  const store = getHeartbeatStore();

  // Defer far enough that a crash mid-evaluation cannot spin on this row.
  const deferTo = new Date(now.getTime() + PULSE_PARSE_FAILURE_MINUTES * MINUTE_MS);
  const claimed = await store.claimForEval(pulse.id, pulse.nextEvalAt, deferTo);
  if (!claimed) return;

  const verdict = await evaluate(pulse, now);
  const decision = applyPulseGuards(pulse, verdict, now);

  const spoke = decision.speak && decision.prompt ? await speak(pulse, decision.prompt) : false;

  const updates: PulseUpdate = spoke
    ? {
        nextEvalAt: decision.nextEvalAt,
        quietStreak: 0,
        lastSpokeAt: now,
        spokenDateKey: localDateKey(now),
        spokenToday:
          (pulse.spokenDateKey === localDateKey(now) ? pulse.spokenToday : 0) + 1,
      }
    : {
        nextEvalAt: decision.nextEvalAt,
        quietStreak: pulse.quietStreak + 1,
      };

  await store.applyVerdict(pulse.id, updates);

  logger.info("pulse evaluated", {
    accountId: pulse.accountId,
    conversationId: pulse.conversationId,
    spoke,
    blockedBy: decision.blockedBy,
    reason: verdict.reason.slice(0, 80),
    nextEvalAt: decision.nextEvalAt.toISOString(),
  });
}

async function tick(
  evaluate: PulseEvaluator = evaluatePulse,
  /** Injectable clock so tests can escape quiet hours deterministically. */
  now: Date = new Date(),
): Promise<void> {
  const due = await getHeartbeatStore().findDuePulses(now, PULSE_TICK_BATCH_SIZE);

  for (const pulse of due) {
    enqueueForAccount(pulse.accountId, () => evaluateOne(pulse, now, evaluate));
  }
}

/**
 * Record user activity in a conversation. Creates the pulse row on first
 * contact and pushes the next evaluation out — someone who just spoke to you
 * does not need to be pinged.
 */
export async function notePulseActivity(
  accountId: string,
  conversationId: string,
): Promise<void> {
  const now = new Date();
  await getHeartbeatStore().notePulseActivity(
    accountId,
    conversationId,
    now,
    new Date(now.getTime() + PULSE_MIN_MINUTES * MINUTE_MS),
  );
}

export function startHeartbeat(): void {
  if (tickTimer) return;

  tickTimer = setInterval(() => {
    tick().catch((err) => logger.error("tick error", { error: err }));
  }, TICK_INTERVAL_MS);

  // unref so this timer doesn't prevent process exit
  tickTimer.unref();

  logger.info("started", { tickIntervalSeconds: TICK_INTERVAL_MS / 1000 });
}

export function stopHeartbeat(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    logger.info("stopped");
  }
}

/**
 * Exposed for tests — runs one scan without waiting for the interval, and
 * optionally with a stand-in evaluator so no model is called.
 */
export { tick as runHeartbeatTick };
