/**
 * Async write queue for tape entries — mirrors queuePersistMessage() pattern.
 *
 * Fire-and-forget from the hot path; retries with exponential backoff.
 */

import { record } from "./service.js";
import type { RecordParams } from "./types.js";
import { getMemoryEventStore } from "../ports/memory-event-store.js";
import { memoryEventTotal } from "@clawbot/observability";
import {
  writeMemoryFactToLedger,
  type MemoryFactEvidence,
} from "./fact-writer.js";

interface QueueItem {
  accountId: string;
  branch: string;
  params: RecordParams;
  attempts: number;
  /**
   * Phase 5：携带记忆事实信息时，队列任务在 Tape 写入前先做账本双写
   * （derive → memory_asserted/superseded → Tape，账本先行，见设计 §5.1）。
   */
  fact?: {
    scope: "global" | "session";
    category: "fact" | "preference" | "decision";
    key: string;
    value: unknown;
    confidence: number;
    evidence: MemoryFactEvidence;
  };
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
      // 账本先行：Memory Event 失败只放弃入账（fail-open），Tape 照常写。
      if (current.fact) {
        try {
          const outcome = await writeMemoryFactToLedger(
            { memoryEventStore: getMemoryEventStore() },
            {
              accountId: current.accountId,
              branch: current.branch,
              scope: current.fact.scope,
              category: current.fact.category,
              key: current.fact.key,
              value: current.fact.value,
              confidence: current.fact.confidence,
              evidence: current.fact.evidence,
            },
          );
          memoryEventTotal.inc({ result: outcome.result });
        } catch (error) {
          memoryEventTotal.inc({ result: "failed" });
          console.error(
            `[memory] ledger write error (${current.accountId}/${current.branch}/${current.fact.category}):`,
            error,
          );
        }
      }

      await record(current.accountId, current.branch, current.params);
      queue.shift();
    } catch (error) {
      current.attempts += 1;
      const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(current.attempts, 5));
      console.error(
        `[tape] record error (${current.accountId}/${current.branch}/${current.params.category}):`,
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

/**
 * Phase 5：带证据链的记忆双写入队（账本 + Tape 同队列任务内串行）。
 * 确定性 eventId 让队列重试天然幂等。
 */
export function queueMemoryFactWrite(item: {
  accountId: string;
  branch: string;
  params: RecordParams;
  fact: {
    scope: "global" | "session";
    category: "fact" | "preference" | "decision";
    key: string;
    value: unknown;
    confidence: number;
    evidence: MemoryFactEvidence;
  };
}): void {
  queue.push({ ...item, attempts: 0 });
  void flushQueue();
}

export function getPendingTapeWriteCount(): number {
  return queue.length;
}
