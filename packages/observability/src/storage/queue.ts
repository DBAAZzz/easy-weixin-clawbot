/**
 * 异步缓冲队列 + 批量写入
 *
 * 设计：
 * - 非阻塞入队（enqueue），不 await
 * - 批量阈值（默认 50 条）或定时（默认 2s）触发 flush
 * - 写入失败指数退避重试，最多 3 次
 * - flush 互斥：同时只有一次 flush 在执行，避免并发写入
 */

import type { SpanData, TraceSummary } from "../trace/types.js";
import type { TraceQueueItem, TraceWriter } from "./types.js";

/** 队列配置 */
export interface QueueOptions {
  /** 批量写入阈值，默认 50 */
  batchSize?: number;
  /** 定时 flush 间隔 ms，默认 2000 */
  flushIntervalMs?: number;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 2_000;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Trace 持久化队列
 *
 * 使用方式：
 *   const queue = new TraceQueue(writer, { batchSize: 50 });
 *   queue.enqueue(summary, spans, sampled);  // 非阻塞
 */
export class TraceQueue {
  private readonly queue: TraceQueueItem[] = [];
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxRetries: number;
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly writer: TraceWriter,
    options?: QueueOptions,
  ) {
    this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushIntervalMs = options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /** 非阻塞入队 */
  enqueue(summary: TraceSummary, spans: SpanData[], sampled: boolean): void {
    this.queue.push({ summary, spans, sampled, attempts: 0 });

    if (this.queue.length >= this.batchSize) {
      // 达到批量阈值，立即触发
      void this.flush();
    } else if (!this.flushTimer) {
      // 启动定时 flush
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.flushIntervalMs);
      // 不阻止进程退出
      this.flushTimer.unref?.();
    }
  }

  /** 批量 flush（互斥 + 重试） */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 取出当前队列快照，避免写入过程中新入队的项被重复处理
    const batch = this.queue.splice(0, this.queue.length);

    try {
      // 1. 汇总行始终写入（不论是否采样）
      await this.writer.writeTraces(batch);

      // 2. span 明细行仅写入采样命中的
      const sampledBatch = batch.filter((item) => item.sampled);
      if (sampledBatch.length > 0) {
        await this.writer.writeSpans(sampledBatch);
      }
    } catch (error) {
      // 写入失败，可重试的项重新入队
      for (const item of batch) {
        item.attempts += 1;
        if (item.attempts <= this.maxRetries) {
          this.queue.push(item);
        } else {
          console.error(
            `[observability] 放弃写入 trace ${item.summary.traceId}（重试 ${item.attempts} 次失败）`,
            error,
          );
        }
      }

      // 指数退避调度下次 flush
      if (this.queue.length > 0) {
        const maxAttempt = Math.max(...batch.map((i) => i.attempts));
        const backoffMs = Math.min(10_000, 1_000 * 2 ** Math.min(maxAttempt, 4));
        const timer = setTimeout(() => void this.flush(), backoffMs);
        timer.unref?.();
      }
    } finally {
      this.flushing = false;
    }
  }

  /** 当前队列深度（指标暴露用） */
  get depth(): number {
    return this.queue.length;
  }
}
