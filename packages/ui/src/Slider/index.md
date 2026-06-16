---
title: Slider
group: 表单组件
description: 用于连续数值调节。当前组件对外只暴露单值模式。
---

# Slider

用于连续数值调节。当前组件对外只暴露单值模式。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性          | 描述                  | 类型                             | 默认值  |
| ------------- | --------------------- | -------------------------------- | ------- |
| value         | 当前数值。            | `number`                         | -       |
| min           | 最小值。              | `number`                         | `0`     |
| max           | 最大值。              | `number`                         | `1`     |
| step          | 步进值。              | `number`                         | `0.01`  |
| onValueChange | 数值变化回调。        | `(value: number) => void`        | -       |
| disabled      | 是否禁用。            | `boolean`                        | `false` |
| className     | 自定义类名。          | `string`                         | -       |
| ...divProps   | 继承原生 `div` 属性。 | `HTMLAttributes<HTMLDivElement>` | -       |
