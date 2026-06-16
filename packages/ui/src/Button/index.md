---
title: Button
group: 基础组件
description: 用于明确动作入口。覆盖品牌主按钮、深色强调、次级、幽灵和危险操作。
---

# Button

用于明确动作入口。主要动作使用 `primary`，强强调操作使用 `ink`，次级操作使用 `secondary` 或 `ghost`，危险操作使用 `danger`。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### Button

| 属性           | 描述                                               | 类型                                                       | 默认值      |
| -------------- | -------------------------------------------------- | ---------------------------------------------------------- | ----------- |
| variant        | 按钮视觉语义。                                     | `'primary' \| 'ink' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` |
| size           | 按钮尺寸。                                         | `'sm' \| 'md'`                                             | `'md'`      |
| fullWidth      | 是否撑满父容器宽度。                               | `boolean`                                                  | `false`     |
| type           | 原生按钮类型。                                     | `'button' \| 'submit' \| 'reset'`                          | `'button'`  |
| disabled       | 是否禁用。                                         | `boolean`                                                  | `false`     |
| children       | 按钮内容。仅传入单个图标元素时会自动使用方形按钮。 | `ReactNode`                                                | -           |
| className      | 自定义类名。                                       | `string`                                                   | -           |
| ...buttonProps | 继承原生 `button` 属性。                           | `ButtonHTMLAttributes<HTMLButtonElement>`                  | -           |

### buttonClassName

用于给非 `button` 节点复用按钮样式，例如 `Link`。

| 参数      | 描述                       | 类型                                                       | 默认值      |
| --------- | -------------------------- | ---------------------------------------------------------- | ----------- |
| variant   | 按钮视觉语义。             | `'primary' \| 'ink' \| 'secondary' \| 'ghost' \| 'danger'` | `'primary'` |
| size      | 按钮尺寸。                 | `'sm' \| 'md'`                                             | `'md'`      |
| fullWidth | 是否撑满父容器宽度。       | `boolean`                                                  | `false`     |
| iconOnly  | 是否使用方形图标按钮尺寸。 | `boolean`                                                  | `false`     |
| className | 追加自定义类名。           | `string`                                                   | -           |
