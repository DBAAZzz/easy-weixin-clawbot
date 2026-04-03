/**
 * 采样判定器
 *
 * 在 trace 结束后调用（tail-based），决定是否持久化 span 明细 + prompt/completion。
 * 无论是否采样，trace 汇总行始终写入（metrics 需要完整统计）。
 *
 * 判定顺序：异常强制保留 → 正常按 normalRate 概率采样。
 * 异常优先级高于概率——保证所有异常 trace 不丢失。
 */

import type { TraceSummary } from "../trace/types.js";
import type { SamplingConfig } from "./types.js";

export function shouldPersistTrace(
  summary: TraceSummary,
  config: SamplingConfig,
): boolean {
  // ── 异常强制保留 ──
  if (config.forceRetain.hasError && summary.hasError) return true;
  if (config.forceRetain.hitMaxRounds && summary.stopReason === "max_rounds")
    return true;
  if (summary.totalMs > config.forceRetain.totalMsThreshold) return true;
  if (
    summary.inputTokens + summary.outputTokens >
    config.forceRetain.totalTokensThreshold
  )
    return true;

  // ── 正常按比例采样 ──
  return Math.random() < config.normalRate;
}
