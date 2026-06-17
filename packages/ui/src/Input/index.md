---
title: Input
group: 表单组件
description: 用于单行文本输入，支持左右图标与紧凑尺寸。
---

# Input

用于单行文本输入，支持左右图标、禁用态和紧凑尺寸。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性           | 描述                    | 类型                                                  | 默认值  |
| -------------- | ----------------------- | ----------------------------------------------------- | ------- |
| value          | 当前输入值。            | `string`                                              | -       |
| placeholder    | 占位提示。              | `string`                                              | -       |
| size           | 输入框尺寸。            | `'sm' \| 'md'`                                        | `'md'`  |
| leftIcon       | 左侧图标。              | `ReactNode`                                           | -       |
| rightIcon      | 右侧图标。              | `ReactNode`                                           | -       |
| disabled       | 是否禁用。              | `boolean`                                             | `false` |
| readOnly       | 是否只读。              | `boolean`                                             | `false` |
| className      | 自定义外层容器类名。    | `string`                                              | -       |
| inputClassName | 自定义输入框类名。      | `string`                                              | -       |
| ...inputProps  | 继承原生 `input` 属性。 | `Omit<InputHTMLAttributes<HTMLInputElement>, "size">` | -       |
