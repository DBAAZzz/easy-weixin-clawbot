/**
 * 质量信号模块
 *
 * 仅确定性指标，不做模糊推断——每个 flag 都有明确的判定规则，零歧义。
 * 从 TraceSummary 中提取质量 flags，写入 Trace 汇总表的 flags 字段。
 */

import type { TraceSummary } from "../trace/types.js";

/** 支持的质量信号标记 */
export type QualityFlag = "error" | "max_rounds" | "slow" | "expensive";

export interface QualityThresholds {
  /** 端到端耗时阈值 ms，超过标记为 slow */
  slowMs: number;
  /** 总 token 阈值，超过标记为 expensive */
  expensiveTokens: number;
}

export const defaultThresholds: QualityThresholds = {
  slowMs: 30_000,
  expensiveTokens: 50_000,
};

/**
 * 从 trace 汇总中提取质量标记
 */
export function buildFlags(
  summary: TraceSummary,
  thresholds: QualityThresholds = defaultThresholds,
): QualityFlag[] {
  const flags: QualityFlag[] = [];

  if (summary.hasError) flags.push("error");
  if (summary.stopReason === "max_rounds") flags.push("max_rounds");
  if (summary.totalMs > thresholds.slowMs) flags.push("slow");
  if (
    summary.inputTokens + summary.outputTokens >
    thresholds.expensiveTokens
  )
    flags.push("expensive");

  return flags;
}
