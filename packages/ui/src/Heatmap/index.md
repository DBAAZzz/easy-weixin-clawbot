---
title: Heatmap
group: 展示组件
description: 按周排列的活跃度热力图，用颜色深浅表达每日强度。
---

# Heatmap

按 GitHub 贡献图语义渲染一组按星期排列的方块：每格颜色由 `level`（0–4）决定，hover 显示当日明细，底部按每月 1 号所在周列自动标注月份。适合「最近一年活跃度」这类展示场景。数据的口径、分桶（`level`）由调用方在业务层算好，组件只负责渲染。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### Heatmap

| 属性      | 描述                       | 类型            | 默认值 |
| --------- | -------------------------- | --------------- | ------ |
| cells     | 单元格数据，按时间升序排列 | `HeatmapCell[]` | -      |
| className | 透传到根节点的自定义 class | `string`        | -      |

### HeatmapCell

| 属性  | 描述                                                          | 类型                    | 默认值 |
| ----- | ------------------------------------------------------------- | ----------------------- | ------ |
| date  | ISO 日期（`YYYY-MM-DD`），用于按周排列，也是 tooltip 兜底文案 | `string`                | -      |
| level | 强度等级，0 为闲置色，1–4 由浅到深                            | `0 \| 1 \| 2 \| 3 \| 4` | -      |
| label | hover 时的 tooltip 内容                                       | `ReactNode`             | `date` |
