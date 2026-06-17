---
title: Sonner
group: 反馈组件
description: 应用级通知。页面只需要挂载一个 AppToaster。
---

# Sonner

应用级通知。页面只需要挂载一个 `AppToaster`。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### AppToaster

| 属性 | 描述                             | 类型 | 默认值 |
| ---- | -------------------------------- | ---- | ------ |
| -    | 使用内置通知配置，无需传入属性。 | -    | -      |

### toast

| 属性          | 描述           | 类型                          | 默认值 |
| ------------- | -------------- | ----------------------------- | ------ |
| toast.success | 触发成功通知。 | `(message, options?) => void` | -      |
| toast.error   | 触发错误通知。 | `(message, options?) => void` | -      |
| toast.info    | 触发信息通知。 | `(message, options?) => void` | -      |
| toast.warning | 触发警告通知。 | `(message, options?) => void` | -      |
| toast.loading | 触发加载通知。 | `(message, options?) => void` | -      |
