# Web 侧边栏：按路由切换菜单（Sidebar Menu Variants）

## 背景与目标

某些路由进入后，左侧菜单需要从「全局菜单」整体切换成该路由专属的菜单，右侧照常渲染路由自己的内容；后续会有多个路由有这种需求。

设计目标：

- 菜单由**路由决定**，同步渲染——无全局状态、无 effect、无首屏闪烁。
- **可扩展**：新增一个带专属菜单的区段只需登记，不动核心逻辑。
- 数据流干净：菜单变体各自取数，不层层透传。

首个落地场景：把原本以弹窗实现的「设置」改成 `/settings/*` 路由 + 设置菜单变体（见文末「应用案例」）。

## 适用判断

本方案针对的场景特征（设置页正好命中）：

- 自定义菜单内容**每个路由固定写死**（静态，编码时已知）。
- 进入该路由后**完全替换**默认全局菜单（而非在默认菜单上增删）。

若菜单内容依赖**运行时数据**，按数据来源再分两种：

- **能从 URL 重建**（path/search 参数 + 共享 React Query hook 取数）：仍走本方案的注册表——变体组件内部 `useParams` + hook 自取数据即可，无需新机制。见 [2026-06-19_20_54_web-sidebar-conversation-variant.md](./2026-06-19_20_54_web-sidebar-conversation-variant.md)（账号会话列表）。
- **依赖 URL 之外的页面本地状态**（未保存编辑、向导步骤、非 URL 参数的请求结果）：才需要在注册表之上叠一个轻量 context slot，让页面把菜单节点推给侧边栏——当前未实现，按需扩展。

## 整体结构

```
路由 (routes.ts)                 ┌─ RouteConfig.sidebar?: SidebarVariant
   │  每条路由可声明它要哪套菜单 ─┘   （省略 = "default"）
   ▼
Sidebar (Sidebar.tsx)
   useLocation() ─► resolveSidebarNav(pathname)
                         │  用 matchPath 命中当前路由，取其 variant
                         ▼
              sidebarVariants.ts  ── variant → 菜单组件 的注册表
                         │
                         ▼
                <SidebarNav collapsed={...} />   ← 渲染在 Logo 与 Footer 之间
```

- `Sidebar` 仍负责外壳：Logo、底部操作（设置/退出）、拖拽改宽。
- 中间的导航区由「当前路由的 variant」决定渲染哪套菜单。
- 右侧内容区始终是 `AppShell` 里的 `<Outlet/>`，与菜单解耦。

## 关键文件

| 文件 | 职责 |
|------|------|
| `router/routes.ts` | `SidebarVariant` 类型；`RouteConfig.sidebar?` 字段；各路由声明所属 variant |
| `layout/Sidebar/sidebarVariants.ts` | `variant → 菜单组件` 注册表；`resolveSidebarNav(pathname)`；导出 `SidebarNavProps` |
| `layout/Sidebar/Sidebar.tsx` | `useLocation()` 解析 variant 并渲染对应菜单组件 |
| `layout/Sidebar/DefaultSidebarNav.tsx` | 默认全局菜单（自取 `useAccounts/useHealth` 算徽标，仅收 `collapsed`） |
| `layout/Sidebar/SettingsSidebarNav.tsx` | 设置菜单变体（首个案例） |
| `layout/Sidebar/{NavItem,MenuSection}.tsx` | 复用的菜单项 / 分组原子组件 |

## 工作原理

### 1. 路由声明菜单

```ts
// router/routes.ts
export type SidebarVariant = "default" | "settings";

export interface RouteConfig {
  path: string;
  Component: LazyExoticComponent<ComponentType>;
  /** 侧边栏菜单变体，省略 = "default"。 */
  sidebar?: SidebarVariant;
}
```

### 2. 注册表 + 解析

```ts
// layout/Sidebar/sidebarVariants.ts
export interface SidebarNavProps {
  collapsed: boolean;
}

const SIDEBAR_NAV_VARIANTS: Record<SidebarVariant, ComponentType<SidebarNavProps>> = {
  default: DefaultSidebarNav,
  settings: SettingsSidebarNav,
};

export function resolveSidebarNav(pathname: string): ComponentType<SidebarNavProps> {
  const matched = protectedRoutes.find((route) => matchPath(route.path, pathname));
  return SIDEBAR_NAV_VARIANTS[matched?.sidebar ?? "default"];
}
```

> **为什么用 `matchPath` 而非 `useMatches`**：项目用的是 `<BrowserRouter>` + `<Routes>`（组件式路由），`useMatches` 仅在 data router（`createBrowserRouter`）下可用。`protectedRoutes` 的 path 都是精确模式，一个 pathname 只命中一条，无歧义、无需排序。

### 3. Sidebar 渲染

```tsx
// layout/Sidebar/Sidebar.tsx
const { pathname } = useLocation();
const SidebarNav = resolveSidebarNav(pathname);
// ...
<SidebarNav collapsed={props.collapsed} />
```

### 数据流约定

菜单变体**各自取数**，不通过 props 透传：

- `useAccounts` / `useHealth` / `useAppSettings` 等均为 React Query hook，同一 `queryKey` 跨组件自动去重缓存。
- 因此 `DefaultSidebarNav` 直接调 `useAccounts/useHealth` 计算徽标，`Sidebar`/`AppShell` 不再为侧边栏取数、不再透传 `accounts/health`。
- 每个变体只收 `collapsed`，签名干净；静态变体连数据都不用碰。

## 如何新增一个带专属菜单的区段（3 步）

```ts
// 1) router/routes.ts —— 加 variant key，并给路由声明
export type SidebarVariant = "default" | "settings" | "workspace";

{ path: "/workspace", Component: WorkspacePage, sidebar: "workspace" },
{ path: "/workspace/:id", Component: WorkspaceDetailPage, sidebar: "workspace" }, // 子路由共享同套菜单
```

```tsx
// 2) layout/Sidebar/WorkspaceSidebarNav.tsx —— 静态菜单，仅收 collapsed
import { MenuSection } from "./MenuSection.js";
import { NavItem } from "./NavItem.js";
import type { SidebarNavProps } from "./sidebarVariants.js";

export function WorkspaceSidebarNav({ collapsed }: SidebarNavProps) {
  return (
    <MenuSection label="工作区" collapsed={collapsed}>
      <NavItem to="/" label="返回控制台" icon={<ChevronLeftIcon className="size-4" />} collapsed={collapsed} />
      <NavItem to="/workspace" label="概览" icon={<...} collapsed={collapsed} />
      {/* … */}
    </MenuSection>
  );
}
```

```ts
// 3) layout/Sidebar/sidebarVariants.ts —— 登记
const SIDEBAR_NAV_VARIANTS = {
  default: DefaultSidebarNav,
  settings: SettingsSidebarNav,
  workspace: WorkspaceSidebarNav,
};
```

进入 `/workspace*` 时左侧自动整套换成 workspace 菜单，右侧由 `<Outlet/>` 渲染对应内容。所有未声明 `sidebar` 的路由继续走 `default`。

## 应用案例：设置（弹窗 → 路由）

原「设置」是一个弹窗，本质即「左侧 4 项导航 + 右侧面板区」。迁移后：

- **弹窗左侧导航** → 全局侧边栏的 `settings` 变体菜单（返回控制台 + 通用 / RSS / 资产存储 / 网络搜索）。
- **弹窗右侧 body** → 4 个独立页面，由 `<Outlet/>` 渲染。

### 路由

全部 `sidebar: "settings"`：

```ts
{ path: "/settings", Component: SettingsGeneralPage, sidebar: "settings" },         // 裸路径兜底渲染通用页
{ path: "/settings/general", Component: SettingsGeneralPage, sidebar: "settings" },
{ path: "/settings/rss", Component: SettingsRssPage, sidebar: "settings" },
{ path: "/settings/asset-storage", Component: SettingsAssetStoragePage, sidebar: "settings" },
{ path: "/settings/network-search", Component: SettingsNetworkSearchPage, sidebar: "settings" },
```

`lazy-pages.ts` 直接懒加载 `components/settings/` 下的面板组件，无额外包装层。

### 面板重构为独立页面

4 个 `components/settings/*Panel.tsx`：

- 去掉 `active` prop → 零 prop 组件；`useAppSettings()` / `useWebSearchProviders()` 默认开启取数（同 query key 去重）。
- `useEffect` 去掉 `active` 守卫，挂载即初始化表单。
- 外层从「弹窗满高 + 内部滚动 + `!active && hidden`」改为页面流式布局 `mx-auto w-full max-w-4xl space-y-5`，靠 `AppShell` 外层滚动；保留各自标题与表单卡片。

### 入口与清理

- 底部「设置」按钮：从打开弹窗改为 `navigate("/settings/general")`。
- 移除 `onOpenSettings` prop 链（AppShell → Sidebar → SidebarFooter）。
- `AppShell` 移除 `settingsOpen` state 与 `<SettingsDialog>` 挂载；删除 `SettingsDialog.tsx`。

## 行为变化与权衡

1. **草稿不再跨分区保留**：旧弹窗 4 面板常驻挂载，切 tab 不丢未保存输入；现在每个分区是独立路由，切换会卸载/重挂载并重新初始化表单。设置页通常可接受；若需保留需另加状态托管。
2. **`/settings` 与 `/settings/general` 都渲染通用页**：`/settings` 作为兜底，按钮与菜单都指向带 `:section` 的规范地址；裸 `/settings` 时菜单项不会高亮（属正常）。
3. **`返回控制台` 入口**：因为全局菜单被整套替换，设置变体内提供一个回到 `/` 的入口，避免用户「出不去」。同类新区段建议照此提供返回入口。
