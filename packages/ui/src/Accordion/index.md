---
title: Accordion
group: 展示组件
description: 用于折叠辅助信息，默认不承载页面主流程。
---

# Accordion

用于折叠辅助信息，默认不承载页面主流程。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性             | 描述                                         | 类型        | 默认值  |
| ---------------- | -------------------------------------------- | ----------- | ------- |
| title            | 触发区域的主标题内容。                       | `ReactNode` | -       |
| meta             | 标题右侧的辅助信息，常用于状态、数量或标签。 | `ReactNode` | -       |
| children         | 折叠面板展开后的内容。                       | `ReactNode` | -       |
| defaultOpen      | 初始是否展开。                               | `boolean`   | `false` |
| className        | 根节点自定义类名。                           | `string`    | -       |
| contentClassName | 内容区域自定义类名。                         | `string`    | -       |
