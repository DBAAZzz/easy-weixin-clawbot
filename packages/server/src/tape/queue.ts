/**
 * Async write queue for tape entries — mirrors queuePersistMessage() pattern.
 *
 * Fire-and-forget from the hot path; retries with exponential backoff.
 */

import { log } from "../logger.js";
import { record } from "./service.js";
import type { RecordParams } from "./types.js";

interface QueueItem {
  accountId: string;
  branch: string;
  params: RecordParams;
  attempts: number;
}

const queue: QueueItem[] = [];
let flushing = false;
let retryTimer: NodeJS.Timeout | null = null;

async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  while (queue.length > 0) {
    const current = queue[0];

    try {
      await record(current.accountId, current.branch, current.params);
      queue.shift();
    } catch (error) {
      current.attempts += 1;
      const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(current.attempts, 5));
      log.error(
        `tape.record(${current.accountId}/${current.branch}/${current.params.category})`,
        error,
      );
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void flushQueue();
      }, backoffMs);
      retryTimer.unref?.();
      break;
    }
  }

  flushing = false;
}

export function queueRecordEntry(
  accountId: string,
  branch: string,
  params: RecordParams,
): void {
  queue.push({ accountId, branch, params, attempts: 0 });
  void flushQueue();
}

export function getPendingTapeWriteCount(): number {
  return queue.length;
}
