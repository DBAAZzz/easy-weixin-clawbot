/**
 * 指标类型定义
 *
 * 轻量级内存聚合，不依赖 Prometheus client 等外部库。
 * 通过 /api/metrics 端点暴露，或由上层接入 Prometheus exporter。
 */

export interface CounterOptions {
  name: string;
  help: string;
  labelNames: string[];
}

export interface HistogramOptions {
  name: string;
  help: string;
  labelNames: string[];
  /** 桶边界，如 [50, 100, 250, 500, 1000, 2500, 5000, 10000] */
  buckets: number[];
}

export interface GaugeOptions {
  name: string;
  help: string;
  labelNames: string[];
}

/** 计数器：只增不减（如请求总数、token 累计） */
export interface Counter {
  inc(labels: Record<string, string>, value?: number): void;
  get(labels: Record<string, string>): number;
}

/** 直方图：分布统计（如耗时分布） */
export interface Histogram {
  observe(labels: Record<string, string>, value: number): void;
  /** 返回指定分位数 */
  percentile(labels: Record<string, string>, p: number): number;
}

/** 仪表盘：可增可减的瞬时值（如队列深度、活跃会话数） */
export interface Gauge {
  set(labels: Record<string, string>, value: number): void;
  inc(labels: Record<string, string>, value?: number): void;
  dec(labels: Record<string, string>, value?: number): void;
  get(labels: Record<string, string>): number;
}
