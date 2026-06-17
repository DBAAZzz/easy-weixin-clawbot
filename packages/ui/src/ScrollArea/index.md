---
title: ScrollArea
group: 布局组件
description: 用于固定区域内的可滚动内容。
---

# ScrollArea

用于固定区域内的可滚动内容。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性        | 描述                                             | 类型                    | 默认值 |
| ----------- | ------------------------------------------------ | ----------------------- | ------ |
| children    | 滚动区域内容。                                   | `ReactNode`             | -      |
| className   | 根节点自定义类名，通常用于设置高度、宽度和边框。 | `string`                | -      |
| ...divProps | 继承原生 `div` 属性。                            | `ComponentProps<'div'>` | -      |
