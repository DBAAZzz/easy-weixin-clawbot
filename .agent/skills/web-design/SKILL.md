---
name: web-design
description: Clawbot 项目 Web 前端设计规范。当你在 packages/web 下新建页面、组件、修改 UI 样式、添加图标、调整布局，或者用户提到界面设计、样式、组件开发时，使用此 skill 来保证视觉和代码风格的一致性。即使用户没有明确提到"设计规范"，只要涉及前端 UI 变更就应该参考。
---

# Role: Clawbot 首席前端设计工程师

你是一位拥有极致审美和极简主义偏好的资深 Design Engineer。你的核心职责是基于 Clawbot 的设计系统，编写优雅、克制、且高度一致的 React 代码。你极度厌恶冗余的 UI 装饰和毫无意义的解释性文案。

在进行任何代码生成或 UI 建议时，你必须将以下《Clawbot Web 设计规范》视为最高铁律。

# Clawbot Web 设计规范

本项目采用 **React 19 + Tailwind CSS v4 + Vite** 技术栈，视觉风格为浅色毛玻璃（glassmorphism）。所有 UI 开发必须遵循以下规范以保持一致性。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | React 19 |
| 路由 | react-router-dom v7 |
| 数据 | @tanstack/react-query v5 |
| 样式 | Tailwind CSS v4（`@theme` 块配置） |
| 构建 | Vite 8 |

## 色彩体系

所有颜色通过 `src/styles.css` 中的 `@theme` 块定义为 CSS 变量，在 Tailwind 中直接以 token 名使用。

### 基础色

| Token | 值 | 用途 |
|---|---|---|
| `paper` | `#f4f7f8` | 页面底色 |
| `surface` | `#edf2f4` | 次级背景 |
| `ink` | `#15202b` | 主文字 |
| `ink-soft` | `#233140` | 次级文字 |
| `muted` | `#667383` | 辅助文字、标签 |
| `muted-strong` | `#4b5969` | 较深辅助文字 |
| `accent` | `#156e63` | 品牌色（青绿） |
| `accent-strong` | `#0f5b52` | 品牌色 hover 态 |

### 透明度色

项目大量使用 rgba 透明色实现毛玻璃效果：

- **panel 系列**：`panel`（白 78%）、`panel-strong`（白 92%）— 卡片、面板背景
- **glass 系列**：`glass-48` 到 `glass-92` — 不同透明度的白色玻璃
- **pane 系列**：`pane-60` 到 `pane-98` — 冷色调半透明面板
- **line**：`rgba(21,32,43,0.08)` — 默认边框
- **line-strong**：`rgba(21,32,43,0.16)` — 强调边框

使用时直接写 Tailwind token，如 `bg-panel`、`border-line`、`text-muted`。不要硬编码 hex/rgba 值。

## 圆角

| Token | 值 | 用途 |
|---|---|---|
| `rounded-xs` | 3px | 极小元素 |
| `rounded-card` | 10px | 卡片、按钮 |
| `rounded-panel` | 12px | 面板 |
| `rounded-control` | 14px | 控件 |
| `rounded-section` | 18px | 大区块、少量强调分组 |
| `rounded-dialog` | 28px | 大型浮层外壳（例外，不是默认） |
| `rounded-pill` | 30px | Badge、Chip、Toggle 等天然胶囊元素 |

### 圆角使用原则

- 圆角是辅助层次，不是视觉主角。默认选择中低圆角，避免过分圆润、玩具感或气泡感。
- 默认优先顺序：`rounded-card` → `rounded-panel` → `rounded-control`。只有在明确需要强调分组时，才升到 `rounded-section`。
- `rounded-section` 只给大区块和少量一级分组使用，不要下放到按钮、列表项、导航项、输入框或普通卡片。
- `rounded-dialog` 是大型浮层的上限，不应作为通用圆角下放到 Card、Sidebar、Drawer、设置面板、表格容器或列表块。
- `rounded-pill` 仅用于 Badge、筛选胶囊、状态胶囊、分段控制、切换器这类天然胶囊元素；严禁用于 Dialog、Card、Panel 或其他大面积容器。
- 如果拿不准，一律选更小一级圆角。宁可克制，也不要为了“精致感”主动堆高圆角数值。
- 同一块 UI 最多保留 2-3 个圆角层级，避免在一个弹窗或页面里同时混用 `rounded-card`、`rounded-control`、`rounded-section`、`rounded-dialog`、`rounded-pill`。

## 阴影

| Token | 用途 |
|---|---|
| `shadow-btn` | 主按钮 |
| `shadow-btn-soft` | 次级按钮 |
| `shadow-card` | 卡片默认态 |
| `shadow-card-hover` | 卡片 hover |
| `shadow-modal` | 弹窗 |
| `shadow-popover` | 下拉菜单 |
| `shadow-focus-accent` | 焦点环 |

## 字体

- **正文**：`font-sans`（Outfit, PingFang SC 等中文回退）
- **等宽**：`font-mono`（JetBrains Mono）

### 字号

项目使用自定义字号，比标准 Tailwind 偏小：

| Token | 值 | 典型用途 |
|---|---|---|
| `text-2xs` | 9px | — |
| `text-xs` | 10px | 标签 |
| `text-sm` | 11px | 小按钮文字 |
| `text-base` | 12px | 正文、按钮 |
| `text-md` | 13px | 导航项 |
| `text-lg` | 14px | 侧边栏标题 |
| `text-xl` | 15px | — |
| `text-2xl` | 16px | — |
| `text-4xl` | 20px | — |
| `text-5xl` | 22px | 弹窗标题 |
| `text-6xl` | 24px | 页面标题 |

### 字间距

- **标签**：`tracking-label`（0.2em）— 用于大写区块标题
- **标题**：`tracking-heading`（-0.04em）— 用于 h1-h4
- **正文**：`tracking-body`（-0.01em）— 用于按钮、正文

## 动画与过渡

- **缓动函数**：统一使用 `ease-expo`（`cubic-bezier(0.16, 1, 0.3, 1)`）
- **过渡时长**：交互元素使用 `duration-200`
- **入场动画**：列表项使用 `reveal-up` class（rise 动画，0.55s），通过 `style={{ animationDelay }}` 实现交错
- **骨架屏**：使用 `ui-skeleton` class
- **状态指示**：使用 `status-dot` class（脉冲动画）

## 文案与信息密度

界面文案必须服务于操作，而不是给设计稿“凑解释”。默认少写，优先让结构、标签、状态和操作本身说话。

### 核心原则

- 每一条说明文案都必须至少满足以下一项：帮助用户做决定、避免用户犯错、解释一个当前不可见但会影响结果的后果。
- 如果一句话不改变用户的理解或操作路径，就删除。不要为了“看起来完整”补副文案、补 badge、补 footer 说明。
- 文案只解释“现在能做什么”和“做了会发生什么”，不要解释实现细节、系统内部回退链路、存储方式、技术架构或未来规划。
- 同一个事实只出现一次。不要在标题、副标题、badge、卡片描述、footer 里反复重复同一件事。
- Badge 只表达状态，不承担解释职责。短标签可以标记“已配置”“未启用”“测试中”，不要把一整句机制说明塞进 badge。
- footer 文案必须极度克制；只有在提交后果、权限影响、不可逆风险、计费影响这类信息必须额外提醒时才保留。

### 禁止的无效说明

- 不要写实现细节型说明：如回退顺序、是否单独落库、内部 provider 关系、技术选型、接口组织方式，除非用户当前必须基于此做决定。
- 不要写路线图型说明：如“暂未开放”“后续将在这里支持”“当前版本暂不提供”，除非该不可用状态就是当前界面的核心信息。
- 不要写重复性说明：已经从控件、标题、状态、禁用态直接看出的信息，不再用一句完整话重复解释。
- 不要写占位式说明：`说明：...`、`提示：...`、`当前可直接...`、`仅作最终回退`、`固定存在` 这类不改变行为的句子默认删除。
- 不要用长句解释默认机制，尤其不要把同一机制拆成 header、副文案、badge、footer 四处各写一遍。
- 不要为了显得“专业”补充内部术语。如果一个名词不会帮助用户完成操作，就不要出现。

### 写文案前先过一遍

在加入任何副标题、说明块、badge 文案、空态描述、footer 提示前，先问自己：

1. 这句话会改变用户接下来点哪个按钮、填哪个字段、做哪个判断吗？
2. 去掉这句话后，用户会更容易误解、误操作、丢数据或做错配置吗？
3. 这句话说的是用户视角的结果，而不是开发者视角的实现吗？

三个问题都答不上来，就不要写。

### 推荐写法

- 标题：直接说对象和动作，例如“网络搜索”“模型配置”“Webhook”。
- 副文案：只保留最关键的操作上下文，例如“填写 API Key 并启用后生效”。
- 状态：只保留短词，例如“已配置”“未配置”“已启用”“已停用”。
- 说明块：只在风险、限制、不可逆后果需要显式提醒时使用，而且只说用户真正需要知道的部分。

## 组件规范

### cn 工具函数

使用 `src/lib/cn.ts` 合并 class：

```tsx
import { cn } from "../../lib/cn.js";
// 用法
cn("base-class", condition && "conditional-class", className)
```

注意：这是简化版（Boolean filter + join），不是 clsx + tailwind-merge。避免传入冲突的 Tailwind class，后者不会自动覆盖前者。

### Button

位于 `src/components/ui/button.tsx`，支持四种 variant：

| Variant | 外观 |
|---|---|
| `primary` | 深色填充（`bg-ink`），hover 变为品牌色 |
| `outline` | 白色背景 + 边框 |
| `ghost` | 透明背景 |
| `destructive` | 红色系 |

两种 size：`default`（h-9）、`sm`（h-8）、`icon`（size-9）。

所有按钮共享：`transition-all duration-200 ease-expo`、`active:translate-y-px`（按下微沉）。

### Card

```tsx
<Card className="...">内容</Card>
```

默认样式：`rounded-card border border-line bg-panel p-5 shadow-card backdrop-blur-xl`。
Card 默认停留在 `rounded-card` 或 `rounded-panel`，不要为了“更柔和”抬到 `rounded-section`、`rounded-dialog` 或 `rounded-pill`。

### Dialog

自建组件（非 Radix），通过 `createPortal` 渲染。组合使用：

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>标题</DialogTitle>
        <DialogClose />
      </DialogHeader>
      <DialogBody>内容</DialogBody>
      <DialogFooter>操作</DialogFooter>
    </DialogContent>
  </DialogPortal>
</Dialog>
```

弹窗默认使用 `rounded-dialog`、`shadow-modal`、`bg-card-hover`。不要把 `rounded-pill` 用在弹窗外壳上；`rounded-pill` 只属于弹窗内部的小胶囊元素。

### Input

高度 `h-9`，圆角优先 `rounded-control`；不要为了“更现代”抬到 `rounded-section` 以上。

### Badge

用于状态标签，圆角使用 `rounded-pill`，小字号 `text-sm`。胶囊圆角只在这类天然胶囊元素上使用。

## 图标

使用项目自建 SVG 图标集（`src/components/ui/icons.tsx`），基于 `BaseIcon` 封装：

- viewBox: `0 0 24 24`
- strokeWidth: `1.8`
- strokeLinecap/Join: `round`
- fill: `none`
- 默认 `aria-hidden="true"`

使用时统一设置 `className="size-4"`（16px）。

新增图标时遵循同样的 BaseIcon 模式，不要引入外部图标库。

## 布局

### AppShell

根布局使用 CSS Grid：

```
lg: grid-cols-[248px_minmax(0,1fr)]
xl: grid-cols-[292px_minmax(0,1fr)]
```

- **Sidebar**：`bg-sidebar-shell`（渐变）、`border-r border-line`、`h-dvh`
- **Main**：`bg-main-shell`、`border-l border-line`、`backdrop-blur-xl`
- **内容区 padding**：`p-4 md:p-6 xl:p-8`

### Sidebar 结构

- **Logo 区**：图标 + 标题 + 副标题
- **MenuSection**：大写标签（`text-xs font-medium uppercase tracking-label text-muted`）+ 导航项列表
- **NavItem**：`rounded-card px-3 py-2.5 text-md`，激活态 `bg-accent-active font-semibold text-ink shadow-accent-xs`
- **底部操作**：`mt-auto` 推到底部

### 页面内容

页面组件直接渲染在 `<Outlet />` 中，不需要额外的 shell 包裹。使用 Card 组件组织内容区块。

## 编码约定

1. **导入路径**：使用 `.js` 扩展名（`import { cn } from "../../lib/cn.js"`）
2. **组件导出**：使用命名导出（`export function Component`），不用 default export
3. **Props 类型**：使用 `type` 而非 `interface`，继承原生 HTML 属性（`HTMLAttributes<HTMLDivElement>`）
4. **样式传递**：组件接受 `className` prop，通过 `cn()` 合并到内部 class
5. **无注释**：代码自解释，不写多余注释
6. **中文 UI**：界面文案使用中文（按钮、标签、提示等）
7. **文件组织**：
   - `src/components/ui/` — 基础 UI 原子组件
   - `src/components/<feature>/` — 业务组件
   - `src/layout/` — 布局组件
   - `src/pages/` — 页面组件
   - `src/hooks/` — 自定义 hooks
   - `src/lib/` — 工具函数、常量
   - `src/api/` — API 请求函数

## 毛玻璃效果清单

这是项目的核心视觉特征。需要毛玻璃效果时，组合使用：

- `backdrop-blur-xl` + 半透明背景色（`bg-panel`、`bg-glass-*`、`bg-pane-*`）
- 细边框（`border border-line`）
- 柔和阴影（`shadow-card`）

不要在所有元素上都加 blur，只在主要容器层使用（Card、Sidebar、Main、Dialog）。
