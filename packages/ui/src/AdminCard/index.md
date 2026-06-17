---
title: AdminCard
group: 业务组件
description: 用于后台实体卡片的操作、开关、指标和标签组合。
---

# AdminCard

后台实体卡片的操作、开关、指标和标签组合件。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### CardActionButton

| 属性      | 描述                             | 类型                                                           | 默认值      |
| --------- | -------------------------------- | -------------------------------------------------------------- | ----------- |
| label     | 操作按钮的无障碍标签和悬浮提示。 | `string`                                                       | -           |
| onClick   | 点击操作回调。                   | `() => void`                                                   | -           |
| icon      | 按钮内展示的图标。               | `ReactNode`                                                    | -           |
| tone      | 操作语义色。                     | `'neutral' \| 'primary' \| 'success' \| 'warning' \| 'danger'` | `'neutral'` |
| disabled  | 是否禁用操作。                   | `boolean`                                                      | `false`     |
| className | 自定义类名。                     | `string`                                                       | -           |

### CardActionGroup

| 属性      | 描述           | 类型        | 默认值 |
| --------- | -------------- | ----------- | ------ |
| children  | 操作按钮集合。 | `ReactNode` | -      |
| className | 自定义类名。   | `string`    | -      |

### CardOverflowMenu

| 属性      | 描述                                                              | 类型              | 默认值 |
| --------- | ----------------------------------------------------------------- | ----------------- | ------ |
| items     | 菜单项配置，包含 `label`、`onClick`、`icon`、`tone`、`disabled`。 | `Array<MenuItem>` | -      |
| className | 自定义类名。                                                      | `string`          | -      |

### CardToggle

| 属性      | 描述                               | 类型         | 默认值  |
| --------- | ---------------------------------- | ------------ | ------- |
| enabled   | 当前是否启用。                     | `boolean`    | -       |
| busy      | 是否处于忙碌状态，忙碌时不可切换。 | `boolean`    | `false` |
| label     | 开关的无障碍标签。                 | `string`     | -       |
| onToggle  | 切换回调。                         | `() => void` | -       |
| disabled  | 是否禁用。                         | `boolean`    | `false` |
| className | 自定义类名。                       | `string`     | -       |

### IconTag

| 属性      | 描述           | 类型                                                       | 默认值    |
| --------- | -------------- | ---------------------------------------------------------- | --------- |
| icon      | 标签左侧图标。 | `ReactNode`                                                | -         |
| children  | 标签内容。     | `ReactNode`                                                | -         |
| tone      | 标签状态语义。 | `'online' \| 'offline' \| 'muted' \| 'error' \| 'warning'` | `'muted'` |
| className | 自定义类名。   | `string`                                                   | -         |

### MetricGrid

| 属性      | 描述                                        | 类型               | 默认值 |
| --------- | ------------------------------------------- | ------------------ | ------ |
| items     | 指标项列表，包含 `icon`、`label`、`value`。 | `MetricGridItem[]` | -      |
| columns   | 指标网格列数。                              | `2 \| 3 \| 4`      | `2`    |
| className | 自定义类名。                                | `string`           | -      |
