/**
 * 存储层类型定义
 *
 * 定义 TraceWriter 接口，解耦具体数据库实现。
 * 上层（@clawbot/server）注入 Prisma 实现；测试时可注入内存实现。
 */

import type { SpanData, TraceSummary } from "../trace/types.js";

/** 单条待写入的 trace 队列项 */
export interface TraceQueueItem {
  summary: TraceSummary;
  spans: SpanData[];
  /** 是否采样命中（决定是否写入 span 明细） */
  sampled: boolean;
  /** 重试次数 */
  attempts: number;
}

/** 存储写入器接口——由上层注入具体实现 */
export interface TraceWriter {
  /** 批量写入 trace 汇总行 */
  writeTraces(items: TraceQueueItem[]): Promise<void>;
  /** 批量写入 span 明细行（仅采样命中的） */
  writeSpans(items: TraceQueueItem[]): Promise<void>;
}
