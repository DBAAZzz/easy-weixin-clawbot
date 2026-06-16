---
title: Dialog
group: 反馈组件
description: 用于确认、编辑、配置和详情查看任务的弹窗组件。
---

# Dialog

用于确认、编辑、配置和详情查看任务。优先使用 `DialogFrame`、`ConfirmDialog`、`SplitDialog` 预设组件；只有在结构明显超出预设能力时，再使用底层组合组件。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### DialogFrame

封装遮罩、Portal、内容容器、关闭按钮、头部、内容区和 footer 的通用弹窗外壳。

| 属性             | 描述                        | 类型                                             | 默认值         |
| ---------------- | --------------------------- | ------------------------------------------------ | -------------- |
| open             | 是否打开对话框。            | `boolean`                                        | -              |
| onOpenChange     | 打开状态变化回调。          | `(open: boolean) => void`                        | -              |
| layout           | 弹窗布局。                  | `'dialog' \| 'panel' \| 'split'`                 | `'dialog'`     |
| tone             | 弹窗语义色调。              | `'accent' \| 'success' \| 'danger' \| 'neutral'` | `'accent'`     |
| title            | 标题内容。                  | `ReactNode`                                      | -              |
| description      | 标题下方说明。              | `ReactNode`                                      | -              |
| icon             | 标题前的语义图标。          | `ReactNode`                                      | -              |
| status           | 标题右侧的状态内容。        | `ReactNode`                                      | -              |
| children         | 弹窗主体内容。              | `ReactNode`                                      | -              |
| footer           | footer 右侧内容或操作区域。 | `ReactNode`                                      | -              |
| footerMeta       | footer 左侧元信息。         | `ReactNode`                                      | -              |
| titleMono        | 标题是否使用等宽字体。      | `boolean`                                        | `false`        |
| closeLabel       | 关闭按钮的无障碍标签。      | `string`                                         | `'关闭对话框'` |
| contentClassName | 内容容器自定义类名。        | `string`                                         | -              |
| headerClassName  | 头部自定义类名。            | `string`                                         | -              |
| bodyClassName    | 内容区自定义类名。          | `string`                                         | -              |
| footerClassName  | footer 自定义类名。         | `string`                                         | -              |

### ConfirmDialog

用于删除、启停、提交等短确认场景，内建取消和确认按钮。

| 属性             | 描述                     | 类型                                                       | 默认值         |
| ---------------- | ------------------------ | ---------------------------------------------------------- | -------------- |
| open             | 是否打开对话框。         | `boolean`                                                  | -              |
| onOpenChange     | 打开状态变化回调。       | `(open: boolean) => void`                                  | -              |
| tone             | 弹窗语义色调。           | `'accent' \| 'success' \| 'danger' \| 'neutral'`           | `'accent'`     |
| title            | 标题内容。               | `ReactNode`                                                | -              |
| description      | 标题下方说明。           | `ReactNode`                                                | -              |
| icon             | 标题前的语义图标。       | `ReactNode`                                                | -              |
| status           | 标题右侧的状态内容。     | `ReactNode`                                                | -              |
| children         | 确认说明内容。           | `ReactNode`                                                | -              |
| cancelText       | 取消按钮文案。           | `ReactNode`                                                | `'取消'`       |
| confirmText      | 确认按钮文案。           | `ReactNode`                                                | `'确定'`       |
| confirmVariant   | 确认按钮样式。           | `'danger' \| 'ghost' \| 'ink' \| 'primary' \| 'secondary'` | 随 `tone` 推导 |
| confirmDisabled  | 是否禁用确认按钮。       | `boolean`                                                  | `false`        |
| closeOnConfirm   | 点击确认后是否关闭弹窗。 | `boolean`                                                  | `true`         |
| onConfirm        | 点击确认时触发。         | `() => void`                                               | -              |
| closeLabel       | 关闭按钮的无障碍标签。   | `string`                                                   | `'关闭对话框'` |
| contentClassName | 内容容器自定义类名。     | `string`                                                   | -              |
| headerClassName  | 头部自定义类名。         | `string`                                                   | -              |
| bodyClassName    | 内容区自定义类名。       | `string`                                                   | -              |
| footerClassName  | footer 自定义类名。      | `string`                                                   | -              |

### SplitDialog

用于主内容加侧栏元信息的详情弹窗，内建 split 结构。

| 属性             | 描述                        | 类型                                             | 默认值         |
| ---------------- | --------------------------- | ------------------------------------------------ | -------------- |
| open             | 是否打开对话框。            | `boolean`                                        | -              |
| onOpenChange     | 打开状态变化回调。          | `(open: boolean) => void`                        | -              |
| tone             | 弹窗语义色调。              | `'accent' \| 'success' \| 'danger' \| 'neutral'` | `'accent'`     |
| title            | 标题内容。                  | `ReactNode`                                      | -              |
| description      | 标题下方说明。              | `ReactNode`                                      | -              |
| icon             | 标题前的语义图标。          | `ReactNode`                                      | -              |
| status           | 标题右侧的状态内容。        | `ReactNode`                                      | -              |
| children         | 主内容区内容。              | `ReactNode`                                      | -              |
| sidebar          | 侧栏内容。                  | `ReactNode`                                      | -              |
| footer           | footer 右侧内容或操作区域。 | `ReactNode`                                      | -              |
| footerMeta       | footer 左侧元信息。         | `ReactNode`                                      | -              |
| titleMono        | 标题是否使用等宽字体。      | `boolean`                                        | `true`         |
| closeLabel       | 关闭按钮的无障碍标签。      | `string`                                         | `'关闭对话框'` |
| contentClassName | 内容容器自定义类名。        | `string`                                         | -              |
| headerClassName  | 头部自定义类名。            | `string`                                         | -              |
| bodyClassName    | 内容区自定义类名。          | `string`                                         | -              |
| footerClassName  | footer 自定义类名。         | `string`                                         | -              |

## 底层组合组件

### Dialog

| 属性         | 描述               | 类型                                             | 默认值     |
| ------------ | ------------------ | ------------------------------------------------ | ---------- |
| open         | 是否打开对话框。   | `boolean`                                        | -          |
| onOpenChange | 打开状态变化回调。 | `(open: boolean) => void`                        | -          |
| layout       | 弹窗布局。         | `'dialog' \| 'panel' \| 'split'`                 | `'dialog'` |
| tone         | 弹窗语义色调。     | `'accent' \| 'success' \| 'danger' \| 'neutral'` | `'accent'` |
| children     | 对话框组合内容。   | `ReactNode`                                      | -          |

### DialogPortal

| 属性     | 描述                             | 类型        | 默认值 |
| -------- | -------------------------------- | ----------- | ------ |
| children | 需要渲染到 Portal 的对话框内容。 | `ReactNode` | -      |

### DialogOverlay

| 属性        | 描述                  | 类型                             | 默认值 |
| ----------- | --------------------- | -------------------------------- | ------ |
| className   | 自定义类名。          | `string`                         | -      |
| ...divProps | 继承原生 `div` 属性。 | `HTMLAttributes<HTMLDivElement>` | -      |

### DialogContent

| 属性        | 描述                     | 类型                             | 默认值               |
| ----------- | ------------------------ | -------------------------------- | -------------------- |
| children    | 对话框主体结构。         | `ReactNode`                      | -                    |
| layout      | 覆盖当前内容区域的布局。 | `'dialog' \| 'panel' \| 'split'` | 继承 `Dialog.layout` |
| className   | 自定义类名。             | `string`                         | -                    |
| ...divProps | 继承原生 `div` 属性。    | `HTMLAttributes<HTMLDivElement>` | -                    |

### DialogHeader

| 属性        | 描述                  | 类型                             | 默认值               |
| ----------- | --------------------- | -------------------------------- | -------------------- |
| children    | 标题与说明内容。      | `ReactNode`                      | -                    |
| icon        | 标题前的语义图标。    | `ReactNode`                      | -                    |
| status      | 标题右侧状态内容。    | `ReactNode`                      | -                    |
| layout      | 覆盖头部布局。        | `'dialog' \| 'panel' \| 'split'` | 继承 `Dialog.layout` |
| className   | 自定义类名。          | `string`                         | -                    |
| ...divProps | 继承原生 `div` 属性。 | `HTMLAttributes<HTMLDivElement>` | -                    |

### DialogBody / DialogFooter

| 属性        | 描述                  | 类型                             | 默认值               |
| ----------- | --------------------- | -------------------------------- | -------------------- |
| children    | 区块内容。            | `ReactNode`                      | -                    |
| layout      | 覆盖区块布局。        | `'dialog' \| 'panel' \| 'split'` | 继承 `Dialog.layout` |
| className   | 自定义类名。          | `string`                         | -                    |
| ...divProps | 继承原生 `div` 属性。 | `HTMLAttributes<HTMLDivElement>` | -                    |

### DialogTitle

| 属性            | 描述                 | 类型                                 | 默认值 |
| --------------- | -------------------- | ------------------------------------ | ------ |
| children        | 对话框标题。         | `ReactNode`                          | -      |
| mono            | 使用等宽标题样式。   | `boolean`                            | -      |
| className       | 自定义类名。         | `string`                             | -      |
| ...headingProps | 继承原生 `h2` 属性。 | `HTMLAttributes<HTMLHeadingElement>` | -      |

### DialogDescription

| 属性              | 描述                | 类型                                   | 默认值 |
| ----------------- | ------------------- | -------------------------------------- | ------ |
| children          | 对话框说明文字。    | `ReactNode`                            | -      |
| className         | 自定义类名。        | `string`                               | -      |
| ...paragraphProps | 继承原生 `p` 属性。 | `HTMLAttributes<HTMLParagraphElement>` | -      |

### DialogClose

| 属性           | 描述                     | 类型                                      | 默认值         |
| -------------- | ------------------------ | ----------------------------------------- | -------------- |
| label          | 关闭按钮的无障碍标签。   | `string`                                  | `'关闭对话框'` |
| children       | 自定义关闭按钮内容。     | `ReactNode`                               | `<XIcon />`    |
| className      | 自定义类名。             | `string`                                  | -              |
| ...buttonProps | 继承原生 `button` 属性。 | `ButtonHTMLAttributes<HTMLButtonElement>` | -              |

### DialogAction

| 属性           | 描述                     | 类型                                                       | 默认值        |
| -------------- | ------------------------ | ---------------------------------------------------------- | ------------- |
| children       | 按钮内容。               | `ReactNode`                                                | -             |
| variant        | 按钮样式。               | `'danger' \| 'ghost' \| 'ink' \| 'primary' \| 'secondary'` | `'secondary'` |
| closeOnClick   | 点击后是否关闭弹窗。     | `boolean`                                                  | `false`       |
| className      | 自定义类名。             | `string`                                                   | -             |
| ...buttonProps | 继承原生 `button` 属性。 | `ButtonHTMLAttributes<HTMLButtonElement>`                  | -             |

### DialogSplit / DialogMain / DialogSidebar

| 属性        | 描述               | 类型                          | 默认值 |
| ----------- | ------------------ | ----------------------------- | ------ |
| children    | 区块内容。         | `ReactNode`                   | -      |
| className   | 自定义类名。       | `string`                      | -      |
| ...divProps | 继承原生节点属性。 | `HTMLAttributes<HTMLElement>` | -      |

### DialogSidebarSection

| 属性        | 描述                  | 类型                             | 默认值 |
| ----------- | --------------------- | -------------------------------- | ------ |
| title       | 侧栏分组标题。        | `ReactNode`                      | -      |
| children    | 分组内容。            | `ReactNode`                      | -      |
| className   | 自定义类名。          | `string`                         | -      |
| ...divProps | 继承原生 `div` 属性。 | `HTMLAttributes<HTMLDivElement>` | -      |

### DialogMetaItem

| 属性      | 描述             | 类型        | 默认值 |
| --------- | ---------------- | ----------- | ------ |
| label     | 元信息标签。     | `ReactNode` | -      |
| value     | 元信息值。       | `ReactNode` | -      |
| mono      | 值使用等宽样式。 | `boolean`   | -      |
| className | 自定义类名。     | `string`    | -      |

### DialogStatusBadge

| 属性      | 描述         | 类型                                             | 默认值      |
| --------- | ------------ | ------------------------------------------------ | ----------- |
| children  | 状态内容。   | `ReactNode`                                      | -           |
| tone      | 状态色调。   | `'accent' \| 'success' \| 'danger' \| 'neutral'` | `'success'` |
| className | 自定义类名。 | `string`                                         | -           |

### DialogParamItem

| 属性      | 描述         | 类型        | 默认值  |
| --------- | ------------ | ----------- | ------- |
| name      | 参数名。     | `ReactNode` | -       |
| required  | 是否必填。   | `boolean`   | `false` |
| className | 自定义类名。 | `string`    | -       |
