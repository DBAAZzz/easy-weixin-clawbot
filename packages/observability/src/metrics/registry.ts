/**
 * 指标注册表
 *
 * 集中管理所有 Agent 指标的创建与查询。
 * 提供 createCounter / createHistogram / createGauge 工厂方法，
 * 以及 dump() 用于序列化输出到 /api/metrics 端点。
 */

import type {
  Counter,
  CounterOptions,
  Gauge,
  GaugeOptions,
  Histogram,
  HistogramOptions,
} from "./types.js";

type MetricKind = "counter" | "gauge" | "histogram";

type CounterSeries = {
  labels: Record<string, string>;
  value: number;
};

type GaugeSeries = {
  labels: Record<string, string>;
  value: number;
};

/**
 * 环形缓冲区容量——保留最近 N 个观测值用于 percentile 计算。
 * 超出后覆盖最旧的值。这样 observe() 是 O(1)，内存固定。
 */
const RING_CAPACITY = 4096;

type HistogramSeries = {
  labels: Record<string, string>;
  /** 环形缓冲区：固定长度，写满后从头覆盖 */
  ring: number[];
  /** 下一次写入位置 */
  ringPos: number;
  /** ring 中有效元素个数（未写满时 < RING_CAPACITY） */
  ringLen: number;
  /** 每个 bucket 的累计计数（与 buckets 数组等长），用于 dump */
  bucketCounts: number[];
  sum: number;
  count: number;
};

type MetricFamily =
  | {
      kind: "counter";
      name: string;
      help: string;
      labelNames: string[];
      series: Map<string, CounterSeries>;
    }
  | {
      kind: "gauge";
      name: string;
      help: string;
      labelNames: string[];
      series: Map<string, GaugeSeries>;
    }
  | {
      kind: "histogram";
      name: string;
      help: string;
      labelNames: string[];
      buckets: number[];
      series: Map<string, HistogramSeries>;
    };

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
}

function serializeLabels(
  labelNames: string[],
  labels: Record<string, string>,
): string {
  if (labelNames.length === 0) return "";

  const body = labelNames
    .map((name) => `${name}="${escapeLabelValue(labels[name] ?? "")}"`)
    .join(",");
  return `{${body}}`;
}

function createSeriesKey(
  labelNames: string[],
  labels: Record<string, string>,
): string {
  return labelNames.map((name) => `${name}:${labels[name] ?? ""}`).join("|");
}

function normalizeLabels(
  labelNames: string[],
  labels: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    labelNames.map((name) => [name, labels[name] ?? ""]),
  );
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const normalized = Number.isFinite(p) ? Math.min(Math.max(p, 0), 1) : 0;
  const index = Math.max(0, Math.ceil(sorted.length * normalized) - 1);
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

export class MetricsRegistry {
  private readonly metrics = new Map<string, MetricFamily>();
  private readonly order: MetricFamily[] = [];

  private ensureUniqueName(name: string): void {
    if (this.metrics.has(name)) {
      throw new Error(`Metric already registered: ${name}`);
    }
  }

  private getOrCreateCounterSeries(
    metric: Extract<MetricFamily, { kind: "counter" }>,
    labels: Record<string, string>,
  ): CounterSeries {
    const normalized = normalizeLabels(metric.labelNames, labels);
    const key = createSeriesKey(metric.labelNames, normalized);
    let series = metric.series.get(key);
    if (!series) {
      series = { labels: normalized, value: 0 };
      metric.series.set(key, series);
    }
    return series;
  }

  private getOrCreateGaugeSeries(
    metric: Extract<MetricFamily, { kind: "gauge" }>,
    labels: Record<string, string>,
  ): GaugeSeries {
    const normalized = normalizeLabels(metric.labelNames, labels);
    const key = createSeriesKey(metric.labelNames, normalized);
    let series = metric.series.get(key);
    if (!series) {
      series = { labels: normalized, value: 0 };
      metric.series.set(key, series);
    }
    return series;
  }

  private getOrCreateHistogramSeries(
    metric: Extract<MetricFamily, { kind: "histogram" }>,
    labels: Record<string, string>,
  ): HistogramSeries {
    const normalized = normalizeLabels(metric.labelNames, labels);
    const key = createSeriesKey(metric.labelNames, normalized);
    let series = metric.series.get(key);
    if (!series) {
      series = {
        labels: normalized,
        ring: new Array<number>(RING_CAPACITY),
        ringPos: 0,
        ringLen: 0,
        bucketCounts: new Array<number>(metric.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      metric.series.set(key, series);
    }
    return series;
  }

  private getCounterSeries(
    metric: Extract<MetricFamily, { kind: "counter" }>,
    labels: Record<string, string>,
  ): CounterSeries | undefined {
    const normalized = normalizeLabels(metric.labelNames, labels);
    return metric.series.get(createSeriesKey(metric.labelNames, normalized));
  }

  private getGaugeSeries(
    metric: Extract<MetricFamily, { kind: "gauge" }>,
    labels: Record<string, string>,
  ): GaugeSeries | undefined {
    const normalized = normalizeLabels(metric.labelNames, labels);
    return metric.series.get(createSeriesKey(metric.labelNames, normalized));
  }

  private getHistogramSeries(
    metric: Extract<MetricFamily, { kind: "histogram" }>,
    labels: Record<string, string>,
  ): HistogramSeries | undefined {
    const normalized = normalizeLabels(metric.labelNames, labels);
    return metric.series.get(createSeriesKey(metric.labelNames, normalized));
  }

  createCounter(opts: CounterOptions): Counter {
    this.ensureUniqueName(opts.name);

    const metric: Extract<MetricFamily, { kind: "counter" }> = {
      kind: "counter",
      name: opts.name,
      help: opts.help,
      labelNames: opts.labelNames,
      series: new Map(),
    };
    this.metrics.set(metric.name, metric);
    this.order.push(metric);

    return {
      inc: (labels, value = 1) => {
        const series = this.getOrCreateCounterSeries(metric, labels);
        series.value += value;
      },
      get: (labels) => this.getCounterSeries(metric, labels)?.value ?? 0,
    };
  }

  createHistogram(opts: HistogramOptions): Histogram {
    this.ensureUniqueName(opts.name);

    const metric: Extract<MetricFamily, { kind: "histogram" }> = {
      kind: "histogram",
      name: opts.name,
      help: opts.help,
      labelNames: opts.labelNames,
      buckets: [...opts.buckets].sort((left, right) => left - right),
      series: new Map(),
    };
    this.metrics.set(metric.name, metric);
    this.order.push(metric);

    return {
      observe: (labels, value) => {
        const series = this.getOrCreateHistogramSeries(metric, labels);
        // 环形缓冲区写入
        series.ring[series.ringPos] = value;
        series.ringPos = (series.ringPos + 1) % RING_CAPACITY;
        if (series.ringLen < RING_CAPACITY) series.ringLen += 1;
        // 桶计数累加（用于 dump，O(buckets) 但 buckets 数量极小）
        for (let i = 0; i < metric.buckets.length; i++) {
          if (value <= metric.buckets[i]) series.bucketCounts[i] += 1;
        }
        series.sum += value;
        series.count += 1;
      },
      percentile: (labels, p) => {
        const series = this.getHistogramSeries(metric, labels);
        if (!series || series.ringLen === 0) return 0;
        // 从环形缓冲区取有效切片
        const values = series.ring.slice(0, series.ringLen);
        return percentile(values, p);
      },
    };
  }

  createGauge(opts: GaugeOptions): Gauge {
    this.ensureUniqueName(opts.name);

    const metric: Extract<MetricFamily, { kind: "gauge" }> = {
      kind: "gauge",
      name: opts.name,
      help: opts.help,
      labelNames: opts.labelNames,
      series: new Map(),
    };
    this.metrics.set(metric.name, metric);
    this.order.push(metric);

    return {
      set: (labels, value) => {
        const series = this.getOrCreateGaugeSeries(metric, labels);
        series.value = value;
      },
      inc: (labels, value = 1) => {
        const series = this.getOrCreateGaugeSeries(metric, labels);
        series.value += value;
      },
      dec: (labels, value = 1) => {
        const series = this.getOrCreateGaugeSeries(metric, labels);
        series.value -= value;
      },
      get: (labels) => this.getGaugeSeries(metric, labels)?.value ?? 0,
    };
  }

  /** 序列化所有指标（Prometheus text format 或 JSON） */
  dump(): string {
    const lines: string[] = [];

    for (const metric of this.order) {
      if (metric.series.size === 0) continue;

      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.kind}`);

      if (metric.kind === "counter" || metric.kind === "gauge") {
        for (const series of metric.series.values()) {
          lines.push(
            `${metric.name}${serializeLabels(metric.labelNames, series.labels)} ${series.value}`,
          );
        }
        continue;
      }

      for (const series of metric.series.values()) {
        for (let i = 0; i < metric.buckets.length; i++) {
          const labels = serializeLabels(
            [...metric.labelNames, "le"],
            { ...series.labels, le: String(metric.buckets[i]) },
          );
          lines.push(`${metric.name}_bucket${labels} ${series.bucketCounts[i]}`);
        }

        const infLabels = serializeLabels(
          [...metric.labelNames, "le"],
          { ...series.labels, le: "+Inf" },
        );
        lines.push(`${metric.name}_bucket${infLabels} ${series.count}`);
        lines.push(
          `${metric.name}_sum${serializeLabels(metric.labelNames, series.labels)} ${series.sum}`,
        );
        lines.push(
          `${metric.name}_count${serializeLabels(metric.labelNames, series.labels)} ${series.count}`,
        );
      }
    }

    return lines.join("\n");
  }

  /** 重置所有指标（测试用） */
  reset(): void {
    for (const metric of this.order) {
      metric.series.clear();
    }
  }
}
