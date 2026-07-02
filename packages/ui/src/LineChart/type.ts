export type LineChartPoint = {
  /** X 轴值，ISO 日期字符串（YYYY-MM-DD）。 */
  x: string;
  /** Y 轴数值。 */
  y: number;
};

export type LineChartSeries = {
  /** 系列名，用于 tooltip。 */
  name: string;
  /** 线条颜色，传 CSS 变量以跟随主题，如 `var(--color-accent)`。 */
  color: string;
  points: LineChartPoint[];
};

export type LineChartProps = {
  series: LineChartSeries[];
  /** X 轴刻度与 tooltip 的日期格式化，默认 `M/D`。 */
  formatX?: (x: string) => string;
  /** Y 轴刻度与 tooltip 的数值格式化，默认千分位缩写。 */
  formatY?: (y: number) => string;
  className?: string;
};
