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

| 属性          | 描述                 | 类型                                  | 默认值      |
| ------------- | -------------------- | ------------------------------------- | ----------- |
| value         | 当前选中值。         | `string`                              | -           |
| options       | 选项列表。           | `SelectOption[]`                      | -           |
| onChange      | 选中值变化回调。     | `(value: string) => void`             | -           |
| placeholder   | 未选中时的占位文本。 | `string`                              | `'请选择'`  |
| disabled      | 是否禁用。           | `boolean`                             | `false`     |
| fullWidth     | 是否撑满容器宽度。   | `boolean`                             | `true`      |
| size          | 选择器尺寸。         | `'default' \| 'sm'`                   | `'default'` |
| variant       | 选择器视觉样式。     | `'default' \| 'subtle'`               | `'default'` |
| prefix        | 触发器左侧前缀内容。 | `ReactNode`                           | -           |
| renderValue   | 自定义选中值展示。   | `(option: SelectOption) => ReactNode` | -           |
| renderOption  | 自定义下拉选项展示。 | `(option: SelectOption) => ReactNode` | -           |
| showIndicator | 是否展示选中标记。   | `boolean`                             | `true`      |
| className     | 自定义类名。         | `string`                              | -           |

### SelectOption

| 属性   | 描述                               | 类型        | 默认值 |
| ------ | ---------------------------------- | ----------- | ------ |
| value  | 选项值。                           | `string`    | -      |
| label  | 选项文本，用于默认展示与可访问名。 | `string`    | -      |
| icon   | 选项左侧图标。                     | `ReactNode` | -      |
| suffix | 选项右侧补充内容。                 | `ReactNode` | -      |
