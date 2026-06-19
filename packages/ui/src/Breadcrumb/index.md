---
title: Breadcrumb
group: 基础组件
description: 用于展示当前页面在信息层级中的位置。
---

# Breadcrumb

用于展示当前页面在信息层级中的位置，适合二到三级的后台详情页导航。空字符串、`null`、`undefined` 和 `false` 层级会被忽略。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### Breadcrumb

| 属性        | 描述                             | 类型                          | 默认值   |
| ----------- | -------------------------------- | ----------------------------- | -------- |
| items       | 面包屑层级数据，空层级会被忽略。 | `BreadcrumbItem[]`            | -        |
| backHref    | 返回按钮链接，未传则不显示。     | `string`                      | -        |
| backLabel   | 返回按钮无障碍标签。             | `string`                      | `'返回'` |
| className   | 自定义类名。                     | `string`                      | -        |
| ...navProps | 继承原生 `nav` 属性。            | `HTMLAttributes<HTMLElement>` | -        |

### BreadcrumbItem

| 属性    | 描述                           | 类型        | 默认值   |
| ------- | ------------------------------ | ----------- | -------- |
| label   | 层级显示内容。                 | `ReactNode` | -        |
| href    | 层级链接。当前项不会渲染链接。 | `string`    | -        |
| current | 是否为当前页面。               | `boolean`   | 最后一项 |
