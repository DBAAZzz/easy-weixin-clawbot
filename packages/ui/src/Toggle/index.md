---
title: Toggle
group: 基础组件
description: 用于按钮形态的二态开关，支持 soft / solid 状态样式和三种语义强调。
---

# Toggle

用于收藏、显示状态、编辑模式等单个二态控制。`soft` 适合默认场景，`solid` 适合需要更强确认感的已启用状态。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### Toggle

| 属性            | 描述                                                   | 类型                                  | 默认值     |
| --------------- | ------------------------------------------------------ | ------------------------------------- | ---------- |
| pressed         | 当前是否按下，受控模式使用。                           | `boolean`                             | -          |
| defaultPressed  | 默认是否按下，非受控模式使用。                         | `boolean`                             | `false`    |
| onPressedChange | 按下状态变化回调。                                     | `(pressed: boolean, details) => void` | -          |
| value           | 在 `ToggleGroup` 中标识该项的唯一值。                  | `string`                              | -          |
| variant         | 按下状态样式。                                         | `'soft' \| 'solid'`                   | `'soft'`   |
| tone            | 语义强调色。                                           | `'accent' \| 'success' \| 'ink'`      | `'accent'` |
| size            | 控件尺寸。                                             | `'sm' \| 'md'`                        | `'md'`     |
| fullWidth       | 是否撑满父容器宽度。                                   | `boolean`                             | `false`    |
| type            | 原生按钮类型。                                         | `'button' \| 'submit' \| 'reset'`     | `'button'` |
| disabled        | 是否禁用。                                             | `boolean`                             | `false`    |
| children        | 按钮内容。仅传入单个图标元素时会自动使用方形按钮尺寸。 | `ReactNode`                           | -          |
| className       | 自定义类名。                                           | `string`                              | -          |
| ...buttonProps  | 继承 Base UI Toggle 的按钮属性。                       | `Toggle.Props`                        | -          |

### toggleClassName

用于给自定义按钮节点复用 Toggle 样式。

| 参数         | 描述                       | 类型                                  | 默认值     |
| ------------ | -------------------------- | ------------------------------------- | ---------- |
| variant      | 按下状态样式。             | `'soft' \| 'solid'`                   | `'soft'`   |
| tone         | 语义强调色。               | `'accent' \| 'success' \| 'ink'`      | `'accent'` |
| size         | 控件尺寸。                 | `'sm' \| 'md'`                        | `'md'`     |
| fullWidth    | 是否撑满父容器宽度。       | `boolean`                             | `false`    |
| iconOnly     | 是否使用方形图标按钮尺寸。 | `boolean`                             | `false`    |
| groupVariant | 分组内项目的视觉模式。     | `'segmented' \| 'attached' \| 'line'` | -          |
| className    | 追加自定义类名。           | `string`                              | -          |
