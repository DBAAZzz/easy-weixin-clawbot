---
title: Card
group: 布局组件
description: 用于少量需要边界的内容承载。页面级布局不要把大区域都包进 Card。
---

# Card

用于少量需要边界的内容承载。页面级布局不要把大区域都包进 Card。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性        | 描述                  | 类型                             | 默认值 |
| ----------- | --------------------- | -------------------------------- | ------ |
| children    | 卡片内容。            | `ReactNode`                      | -      |
| className   | 自定义类名。          | `string`                         | -      |
| ...divProps | 继承原生 `div` 属性。 | `HTMLAttributes<HTMLDivElement>` | -      |
