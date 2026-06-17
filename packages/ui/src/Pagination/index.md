---
title: Pagination
group: 基础组件
description: 用于列表、表格等分页导航。
---

# Pagination

用于列表、表格等分页导航。支持受控页码、默认页码、总数与简单页码折叠。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### Pagination

| 属性         | 描述                         | 类型                          | 默认值  |
| ------------ | ---------------------------- | ----------------------------- | ------- |
| total        | 数据总条数。                 | `number`                      | -       |
| page         | 当前页码，传入后组件受控。   | `number`                      | -       |
| defaultPage  | 非受控模式下的默认页码。     | `number`                      | `1`     |
| pageSize     | 每页条数，用于计算总页数。   | `number`                      | `10`    |
| siblingCount | 当前页两侧保留的相邻页数量。 | `number`                      | `1`     |
| disabled     | 是否禁用分页操作。           | `boolean`                     | `false` |
| onPageChange | 页码变化回调。               | `(page: number) => void`      | -       |
| className    | 自定义类名。                 | `string`                      | -       |
| ...navProps  | 继承原生 `nav` 属性。        | `HTMLAttributes<HTMLElement>` | -       |

### paginationClassName

用于给自定义分页容器复用根节点样式。

| 参数      | 描述             | 类型     | 默认值 |
| --------- | ---------------- | -------- | ------ |
| className | 追加自定义类名。 | `string` | -      |
