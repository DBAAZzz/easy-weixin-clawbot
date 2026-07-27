/**
 * Heartbeat Engine — scans for due reminders once a minute and speaks.
 *
 * A reminder fires by running a full chat() turn in the user's real
 * conversation, so the agent answers with everything it knows about them,
 * then pushing that reply to WeChat.
 *
 * Concurrency:
 *   claimById (DELETE ... RETURNING) is the lock — only the caller that
 *   deletes the row runs it, which also holds across processes.
 *   A per-account queue keeps one person from receiving two at once.
 */

import { createLogger } from "@clawbot/observability";
import { getHeartbeatStore } from "../../ports/heartbeat-store.js";
import { getPushService } from "../../ports/push-service.js";
import { getChatExecutor } from "../../ports/chat-executor.js";
import { TICK_BATCH_SIZE } from "./types.js";

const logger = createLogger({ component: "heartbeat.engine" });

const TICK_INTERVAL_MS = 60_000;

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
 * Run one reminder: claim it, generate a message, push it.
 *
 * Nothing is retried. A reminder is time-sensitive — delivering "here's your
 * reminder from ten minutes ago" is worse than staying quiet — and the row is
 * already gone, deliberately: a duplicate push is more damaging than a miss.
 */
async function fireReminder(reminderId: string): Promise<void> {
  const store = getHeartbeatStore();

  const reminder = await store.claimById(reminderId);
  if (!reminder) return;

  const result = await getChatExecutor().execute({
    accountId: reminder.accountId,
    conversationId: reminder.conversationId,
    prompt: reminder.prompt,
    runKind: "heartbeat",
    inputRole: "trigger",
    triggerMeta: { kind: "reminder", reminderId: reminder.reminderId },
  });

  if (result.status === "error") {
    logger.warn("reminder chat failed, dropping", {
      reminderId: reminder.reminderId,
      accountId: reminder.accountId,
      error: result.error,
    });
    return;
  }

  const text = result.text?.trim();
  if (!text) {
    logger.warn("reminder produced no text, nothing to push", {
      reminderId: reminder.reminderId,
    });
    return;
  }

  try {
    // chat() already persisted the assistant message in this conversation;
    // recordHistory: false stops the push from writing it a second time.
    await getPushService().sendProactiveMessage(
      reminder.accountId,
      reminder.conversationId,
      text,
      { recordHistory: false },
    );
  } catch (err) {
    logger.warn("reminder push failed", {
      reminderId: reminder.reminderId,
      accountId: reminder.accountId,
      error: err,
    });
  }
}

async function tick(): Promise<void> {
  const due = await getHeartbeatStore().findDue(new Date(), TICK_BATCH_SIZE);

  for (const reminder of due) {
    enqueueForAccount(reminder.accountId, () => fireReminder(reminder.reminderId));
  }
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

/** Exposed for tests — runs one scan without waiting for the interval. */
export { tick as runHeartbeatTick };
