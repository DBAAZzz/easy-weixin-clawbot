# Web 侧边栏：账号会话列表变体（动态变体设计）

> 本文是 [2026-06-19_20_54_web-sidebar-route-menu-variants.md](./2026-06-19_20_54_web-sidebar-route-menu-variants.md) 的延伸应用：把账号详情页里「通过接口返回的会话列表」复用为侧边栏菜单变体。它同时给出「**动态变体**」这一模式：菜单内容由运行时数据决定，但仍走现有的路由→变体注册表，无需新机制。

## 需求

`/accounts/:accountId`（Conversation 页）现在是**页面自带两栏**：左 `<aside>`（账号头 + 会话列表 + 刷新）+ 右消息区。目标是把左栏「会话列表」升级为全局侧边栏的一个变体，右侧消息区交给 `<Outlet/>`。

难点：会话列表是按 `accountId` 通过接口拉回来的**运行时数据**，菜单项编码时未知。

## 核心结论：URL 可重建的动态数据，仍走注册式变体

判据是「菜单数据能否从 URL 重建」：

- 会话列表只依赖 `accountId`（URL path 参数），且经由 React Query hook `useConversations(accountId)` 获取（queryKey `["conversations", accountId]`）。
- 因此注册表里登记的变体组件 **自己** 就能：`useParams()` 取 `accountId` → `useConversations()` 取数 → `useSearchParams()` 读选中态。它在注册层面是「静态登记一个组件」，内部却是完全动态的。
- 变体与页面调用同一个 query key，React Query **自动去重**，不会重复请求。

**所以无需 context slot，直接套现有 variant 注册表。** 这比「页面把菜单节点推给侧边栏」干净：无 set-on-effect 的首帧闪烁、无额外渲染。

### 什么时候才真的需要 context slot

仅当菜单依赖**URL 之外、页面本地**、无法在侧边栏侧重建的状态时，例如：未保存的编辑态、向导当前步骤、用非 URL 参数发起的请求结果。本需求不属于。

> 这一条同时修正了父文档「依赖运行时数据一概用 slot」的说法：**数据能从 URL 重建（+共享 hook）→ 注册式动态变体；只有 URL 之外的页面本地状态 → slot。** 实施时会把这条纠正回填到父文档。

## 已确定的决策

| 维度 | 决策 |
| --- | --- |
| 选中态 | 保持 `?conversation=<id>` query param，变体与页面读写同一个 search param |
| 折叠态（72px） | 仍显示会话图标，**可点击切换**；hover 出 tooltip 显示标题 |
| 侧边栏宽度 | **不变**（全局 max 仍 268px） |
| 滚动/页脚 | 变体内**列表区独立滚动**，全局**页脚（设置/退出）吸底** |
| 与全局菜单关系 | 进入后**整套替换**中间导航区（Logo、页脚保持） |

## 设计

### 1. 路由声明

```ts
// router/routes.ts
export type SidebarVariant = "default" | "settings" | "conversation";

{ path: "/accounts/:accountId", Component: ConversationPage, sidebar: "conversation" }
```

### 2. ConversationSidebarNav（新变体）

`layout/Sidebar/ConversationSidebarNav.tsx`，接 `SidebarNavProps`（仅 `collapsed`），内部自取数据：

```tsx
export function ConversationSidebarNav({ collapsed }: SidebarNavProps) {
  const { accountId } = useParams<{ accountId: string }>();
  const { conversations, loading, error, refresh } = useConversations(accountId);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedConversationId = searchParams.get("conversation") ?? undefined;
  const select = (id: string) => setSearchParams({ conversation: id });
  // 展开/折叠两套渲染，见下
}
```

#### 展开态（≤268px）

- 顶部：返回入口（→ `/`）。
- 账号头：账号别名/显示名 + 会话数 + 刷新按钮（**固定不滚动**）。
- 列表：复用现有 `ConversationList`（`conversations` / `selectedConversationId` / `onSelect=select`），**独立滚动**。
- 错误/加载骨架沿用页面里现有写法。

#### 折叠态（72px）

- 顶部：返回 `←` 图标按钮。
- 会话：每条渲染成**首字母圆形徽标按钮**（复用页面里 `title.slice(0,1).toUpperCase()` 的逻辑），`onClick=select(id)` 照常切换；选中项高亮；hover 出 tooltip 显示完整标题（沿用 `SidebarActionIconButton` 的 tooltip 范式）。
- 图标栈纵向滚动。

> `ConversationList` 组件**不改动**——只服务展开态富列表；折叠态的图标栈在变体内单独渲染（清晰隔离）。

```text
折叠 (72px)              展开 (≤268px)
[logo]                  [logo · Clawbot]
 ┌──┐                   ← 返回账号列表
 │← │ 返回               账号  myaccount      [刷新]   ← 固定
 ├──┤                   12 条会话
 │A │← 选中(高亮)        ──────────────
 │B │  hover→标题         ▸ Alpha 会话 3条·2h  ┐
 │C │                      Beta  会话  …       │ 独立滚动
 │… │ 独立滚动             …                   ┘
 ├──┤                   ──────────────
 │⚙ │ 设置               ⚙ 设置   ⎋ 退出       ← 吸底
 │⎋ │ 退出
```

### 3. 注册

```ts
// layout/Sidebar/sidebarVariants.ts
const SIDEBAR_NAV_VARIANTS = {
  default: DefaultSidebarNav,
  settings: SettingsSidebarNav,
  conversation: ConversationSidebarNav,
};
```

### 4. Sidebar 外壳：列表独立滚动 + 页脚吸底

为支持「中间列表独立滚动、页脚吸底」，把外壳从「整体单滚动」改成「三段式：Logo 固定 / 导航区 flex-1 / 页脚固定」：

```tsx
// layout/Sidebar/Sidebar.tsx（结构示意）
<div className="flex h-full flex-col overflow-hidden ...">   {/* 外层不再整体滚动 */}
  <SidebarLogo ... />                       {/* shrink-0 固定顶部 */}
  <div className="flex-1 min-h-0">          {/* 导航区：给变体撑出可用高度，自身不滚动 */}
    <SidebarNav collapsed={props.collapsed} />
  </div>
  <SidebarFooter ... />                     {/* shrink-0 固定底部（去掉 mt-auto） */}
</div>
```

- **滚动归变体所有**（避免双层滚动容器）：
  - `DefaultSidebarNav` / `SettingsSidebarNav`：根加 `h-full overflow-y-auto`，长菜单时自身滚动（行为与现状基本一致）。
  - `ConversationSidebarNav`：根 `flex h-full flex-col`，账号头/返回 `shrink-0`，列表区 `flex-1 min-h-0 overflow-y-auto`。
- 宽度逻辑、拖拽改宽、折叠阈值**完全不变**。

### 5. ConversationPage 瘦身为消息区

`features/Conversation/index.tsx`：

- 删除左 `<aside>`（账号头 + 列表 + 刷新整体移入变体）。
- 只保留右侧消息 `<section>`，铺满主内容区（`AppShell` 的 `<Outlet/>` 容器已提供 padding 与滚动）。
- 仍调用 `useConversations(accountId)`（去重）取**选中会话**的标题/元信息，渲染消息区头部。
- **自动选首条**的 effect 只保留一处（建议留在页面，作为始终挂载的路由内容的单一 owner）；变体只负责「点选写 param」，二者通过 `?conversation=` 协同，互不冲突。

## 改动清单（实施时）

1. `router/routes.ts`：`SidebarVariant` 加 `"conversation"`；`/accounts/:accountId` 标 `sidebar: "conversation"`。
2. 新增 `layout/Sidebar/ConversationSidebarNav.tsx`（展开/折叠两套渲染）。
3. `layout/Sidebar/sidebarVariants.ts`：注册 `conversation`。
4. `layout/Sidebar/Sidebar.tsx`：外壳三段式（Logo 固定 / 导航区 flex-1 / 页脚固定）。
5. `layout/Sidebar/SidebarFooter.tsx`：去 `mt-auto`、加 `shrink-0`（配合吸底）。
6. `DefaultSidebarNav.tsx` / `SettingsSidebarNav.tsx`：根加 `h-full overflow-y-auto`（自身滚动）。
7. `features/Conversation/index.tsx`：删左栏、留消息区、保留选中态 effect。
8. 文档：本文 + 回填父文档「动态/slot」纠正与交叉链接。

## 行为变化与注意点

- **会话列表移出页面**：账号详情页正文只剩消息区；会话切换改在全局侧边栏操作。
- **折叠态可用**：72px 下用首字母徽标 + tooltip 仍可切换会话，符合预期。
- **页脚常驻**：会话再多，设置/退出也吸底常显，列表在中间区独立滚动。
- **选中态单一来源**：`?conversation=` 由页面（自动选首条）与变体（点选）共同读写，自动选逻辑只放一处避免重复 `setSearchParams`。
