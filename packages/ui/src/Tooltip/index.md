---
title: Tooltip
group: 基础组件
description: 用于为图标、文本或控件提供悬浮提示信息。
---

# Tooltip

用于为图标、文本或控件提供悬浮提示信息。基于 @base-ui/react Tooltip 封装。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性      | 描述                     | 类型                                     | 默认值  |
| --------- | ------------------------ | ---------------------------------------- | ------- |
| title     | 提示内容。               | `ReactNode`                              | -       |
| children  | 触发提示的元素。         | `ReactNode`                              | -       |
| placement | 提示相对于触发器的位置。 | `'top' \| 'bottom' \| 'left' \| 'right'` | `'top'` |
| delay     | 显示延迟（毫秒）。       | `number`                                 | `200`   |
| className | 提示浮层自定义类名。     | `string`                                 | -       |
