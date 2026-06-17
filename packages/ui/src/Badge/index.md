---
title: Badge
group: 基础组件
description: 用于状态、标签和轻量分类。online、offline 会自动带状态点。
---

# Badge

用于状态、标签和轻量分类。`online`、`offline` 会自动带状态点。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性         | 描述                   | 类型                                                       | 默认值    |
| ------------ | ---------------------- | ---------------------------------------------------------- | --------- |
| tone         | 标签语义状态。         | `'online' \| 'offline' \| 'muted' \| 'error' \| 'warning'` | `'muted'` |
| size         | 标签尺寸。             | `'md' \| 'sm'`                                             | `'md'`    |
| bordered     | 是否展示边框。         | `boolean`                                                  | `true`    |
| children     | 标签内容。             | `ReactNode`                                                | -         |
| className    | 自定义类名。           | `string`                                                   | -         |
| ...spanProps | 继承原生 `span` 属性。 | `HTMLAttributes<HTMLSpanElement>`                          | -         |
