---
title: Select
group: 表单组件
description: 用于少量离散选项。选项过多时优先考虑搜索或过滤控件。
---

# Select

用于少量离散选项。选项过多时优先考虑搜索或过滤控件。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### Select

| 属性        | 描述                 | 类型                      | 默认值      |
| ----------- | -------------------- | ------------------------- | ----------- |
| value       | 当前选中值。         | `string`                  | -           |
| options     | 选项列表。           | `SelectOption[]`          | -           |
| onChange    | 选中值变化回调。     | `(value: string) => void` | -           |
| placeholder | 未选中时的占位文本。 | `string`                  | `'请选择'`  |
| disabled    | 是否禁用。           | `boolean`                 | `false`     |
| size        | 选择器尺寸。         | `'default' \| 'sm'`       | `'default'` |
| className   | 自定义类名。         | `string`                  | -           |

### SelectOption

| 属性  | 描述           | 类型        | 默认值 |
| ----- | -------------- | ----------- | ------ |
| value | 选项值。       | `string`    | -      |
| label | 选项展示文本。 | `string`    | -      |
| icon  | 选项左侧图标。 | `ReactNode` | -      |
