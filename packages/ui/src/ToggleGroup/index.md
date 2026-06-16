---
title: ToggleGroup
group: 基础组件
description: 用于把多个 Toggle 组合为分段选择器，支持 segmented、attached 与 line 三种模式。
---

# ToggleGroup

用于视图切换、状态筛选和文本工具栏。`ToggleGroup` 负责共享状态与容器样式，组内项目继续使用 `Toggle`。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### ToggleGroup

| 属性          | 描述                                      | 类型                                  | 默认值         |
| ------------- | ----------------------------------------- | ------------------------------------- | -------------- |
| value         | 当前按下项的 value 数组，受控模式使用。   | `readonly string[]`                   | -              |
| defaultValue  | 默认按下项的 value 数组，非受控模式使用。 | `readonly string[]`                   | -              |
| onValueChange | 分组值变化回调。                          | `(value: string[], details) => void`  | -              |
| multiple      | 是否允许多个项目同时按下。                | `boolean`                             | `false`        |
| variant       | 分组视觉模式。                            | `'segmented' \| 'attached' \| 'line'` | `'segmented'`  |
| tone          | 语义强调色，会下发给组内 `Toggle`。       | `'accent' \| 'success' \| 'ink'`      | `'accent'`     |
| size          | 控件尺寸，会下发给组内 `Toggle`。         | `'sm' \| 'md'`                        | `'md'`         |
| fullWidth     | 是否撑满父容器宽度。                      | `boolean`                             | `false`        |
| orientation   | 键盘导航与布局方向。                      | `'horizontal' \| 'vertical'`          | `'horizontal'` |
| loopFocus     | 键盘导航到末尾时是否循环焦点。            | `boolean`                             | `true`         |
| disabled      | 是否禁用整个分组。                        | `boolean`                             | `false`        |
| className     | 自定义类名。                              | `string`                              | -              |
| children      | 分组内的 `Toggle`。                       | `ReactNode`                           | -              |
| ...divProps   | 继承 Base UI ToggleGroup 的 div 属性。    | `ToggleGroup.Props`                   | -              |

### toggleGroupClassName

用于给自定义分组容器复用 ToggleGroup 样式。

| 参数        | 描述             | 类型                                  | 默认值         |
| ----------- | ---------------- | ------------------------------------- | -------------- |
| variant     | 分组视觉模式。   | `'segmented' \| 'attached' \| 'line'` | `'segmented'`  |
| size        | 控件尺寸。       | `'sm' \| 'md'`                        | `'md'`         |
| fullWidth   | 是否撑满父容器。 | `boolean`                             | `false`        |
| orientation | 布局方向。       | `'horizontal' \| 'vertical'`          | `'horizontal'` |
| className   | 追加自定义类名。 | `string`                              | -              |
