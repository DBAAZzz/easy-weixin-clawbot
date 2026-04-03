/**
 * 采样策略配置
 *
 * 采样时机：trace 结束后判定（tail-based），而非开始时。
 * 因为开始时不知道是否会出错 / 超长 / 高成本。
 */

export interface SamplingConfig {
  /** 正常 trace 采样率（0.0 ~ 1.0），默认 0.1 即 10% */
  normalRate: number;

  /** 以下条件命中时，强制 100% 保留 */
  forceRetain: {
    /** 任何 span 出错 */
    hasError: boolean;
    /** 跑满 max_rounds */
    hitMaxRounds: boolean;
    /** 端到端耗时超过阈值（ms） */
    totalMsThreshold: number;
    /** Token 消耗超过阈值 */
    totalTokensThreshold: number;
  };
}

export const defaultSamplingConfig: SamplingConfig = {
  normalRate: 0.1,
  forceRetain: {
    hasError: true,
    hitMaxRounds: true,
    totalMsThreshold: 30_000,
    totalTokensThreshold: 50_000,
  },
};
