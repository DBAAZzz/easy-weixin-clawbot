---
title: Switch
group: 表单组件
description: 用于二元状态开关，基于 Base UI Switch 封装。
---

# Switch

用于启用、停用等二元状态控制，支持受控与非受控模式。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性            | 描述                                 | 类型                                   | 默认值     |
| --------------- | ------------------------------------ | -------------------------------------- | ---------- |
| checked         | 当前是否开启。                       | `boolean`                              | -          |
| defaultChecked  | 非受控模式下的默认开启状态。         | `boolean`                              | `false`    |
| onCheckedChange | 状态变化回调。                       | `(checked: boolean, details) => void`  | -          |
| size            | 开关尺寸。                           | `'sm' \| 'md'`                         | `'md'`     |
| tone            | 开启状态的语义强调色。               | `'accent' \| 'success' \| 'ink'`       | `'accent'` |
| label           | 无可见文本时使用的无障碍标签。       | `string`                               | -          |
| disabled        | 是否禁用。                           | `boolean`                              | `false`    |
| readOnly        | 是否只读。                           | `boolean`                              | `false`    |
| className       | 自定义根节点类名。                   | `string`                               | -          |
| ...spanProps    | 继承 Base UI Switch 的 `span` 属性。 | `Omit<Switch.Root.Props, "className">` | -          |
