---
title: LineChart
group: 展示组件
description: 基于 visx 的多系列时间折线图，带坐标轴与悬停 tooltip。
---

# LineChart

按时间渲染一条或多条折线，自带 X/Y 坐标轴、横向网格和最近点 tooltip，宽度自适应容器。颜色由调用方在 `series` 上传入（建议传 `var(--color-*)` 以跟随主题），数据口径与系列拆分由业务层准备。默认高度 220px，可用 `className` 覆盖。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### LineChart

| 属性      | 描述                            | 类型                    | 默认值     |
| --------- | ------------------------------- | ----------------------- | ---------- |
| series    | 折线系列数据                    | `LineChartSeries[]`     | -          |
| formatX   | X 轴刻度与 tooltip 的日期格式化 | `(x: string) => string` | `M/D`      |
| formatY   | Y 轴刻度与 tooltip 的数值格式化 | `(y: number) => string` | 千分位缩写 |
| className | 透传到根节点的自定义 class      | `string`                | -          |

### LineChartSeries

| 属性   | 描述                      | 类型               | 默认值 |
| ------ | ------------------------- | ------------------ | ------ |
| name   | 系列名，用于 tooltip      | `string`           | -      |
| color  | 线条颜色，建议传 CSS 变量 | `string`           | -      |
| points | 数据点                    | `LineChartPoint[]` | -      |

### LineChartPoint

| 属性 | 描述                     | 类型     | 默认值 |
| ---- | ------------------------ | -------- | ------ |
| x    | ISO 日期（`YYYY-MM-DD`） | `string` | -      |
| y    | Y 轴数值                 | `number` | -      |
