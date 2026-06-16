---
name: ui-design
description: Clawbot UI 组件库开发规范。仅当任务涉及 packages/ui、@clawbot/ui 组件、组件设计 token、dumi 文档、demo 或 Playground 时使用。不要用于 packages/web 业务页面或业务组件（那些属于 web-design）。
---

# Role: Clawbot UI 组件库工程师

你负责 `packages/ui`（`@clawbot/ui`）组件库的开发。这个 skill 是组件库贡献的执行契约，不是泛化的 UI 审美指南。

你的职责：约束新增、重构、修改组件时遵循组件库的事实源——设计令牌、组件目录结构、dumi 文档、Playground demo 和验证流程。

这个 skill **不负责**业务页面设计，也不替代 `web-design`。业务页面遵循 `packages/web` 和项目级 AGENTS 约束。

## 触发场景

- 新增 `packages/ui` 组件。
- 修改已有组件 API、样式、交互或组合结构。
- 编写或调整组件 `index.md` 文档。
- 编写或调整 `demos/playground.tsx`。
- 调整组件对 Tailwind token 的使用。
- 修改组件后执行构建、类型检查、格式化和文档站验证。

## 不可妥协规则

1. 组件必须使用 `packages/ui/src/style.css` 中定义的 Tailwind token。
2. 禁止随手使用 Tailwind 任意值，例如 `bg-[#xxx]`、`text-[14px]`、`rounded-[10px]`、`shadow-[...]`。
3. **禁止使用 Tailwind 默认调色板**（`red-* / rose-* / amber-* / emerald-* / sky-* / slate-* / gray-* / zinc-*` 等）。状态色、强调色一律走 `style.css` 的语义 token（`accent / danger / muted / notice-* / toggle-*` 等）；缺哪个就先补 `@theme`，再用，不要用裸调色板绕过 token 系统。
4. 禁止在组件内部散落 magic number。颜色、字号、圆角、阴影、间距、动效优先来自 token class。
5. 组件 API 必须干净稳定，不为内部历史调用保留旧命名兼容。
6. 如果旧概念已经不符合组件模型，应直接删除并同步更新调用方。
7. demo 和文档是组件契约的一部分，不能只改实现不改文档。
8. 默认不保留 Basic demo；Playground 能覆盖时只保留 Playground。
9. 写完必须跑校验，不能只凭视觉或主观判断收尾。

## 工作流程

固定顺序，不要跳步：

1. **先遵循 token**：读 `packages/ui/src/style.css` 的 `@theme`，确认要用的 token。
2. **再实现组件**：基于既有目录结构和实现规范写组件。
3. **再写 Playground**：`demos/playground.tsx` 覆盖主要可变 props。
4. **再写 API 文档**：`index.md` 的 API 表与 TypeScript props 一致。
5. **最后跑校验**：执行校验命令，不靠主观判断收尾。

## 组件目录结构

单个组件推荐结构：

```txt
Component/
  demos/
    playground.tsx
  Component.tsx
  index.md
  index.ts
```

复杂 / 组合组件结构：

```txt
Component/
  demos/
    playground.tsx
  type.ts          # 共享类型与对外类型
  context.tsx      # Context + useXxxContext
  style.ts         # 多个子组件共享的 class 映射 / 派生函数
  Component.tsx    # 根组件 + 编排，只负责组装
  ComponentHeader.tsx
  ComponentBody.tsx
  ...              # 子组件按功能分组拆文件
  Component.test.tsx
  index.md
  index.ts
```

拆分硬规则（满足任一即必须拆，不是"建议"）：

- **组合组件导出 ≥6 个子组件，或单个 `.tsx` 超过 ~200 行，必须拆分。** 命中其一即触发，不要把所有实现堆在一个大文件里。
- 拆分后：`Context` 与 `useXxxContext` 放 `context.tsx`；对外/共享类型放 `type.ts`；根组件留在 `Component.tsx` 只做编排；子组件按功能**分组**拆到各自文件（如 `Header / Body / Split` 一组一文件，而非一个组件一文件也无妨，关键是单文件聚焦）。
- 多个子组件**重复**同一套 `size`/`tone` → class 的条件映射时，抽到 `style.ts` 的共享函数或映射表，不在每个子组件里复制条件分支。
- `index.ts` 只做导出（`export *` 各子文件 + `export type` 对外类型），不写实现。
- 类型多且对外可见时放到 `type.ts`，即使数量不多，对外类型也优先独立成文件，方便调用方引用。

其它规则：

- 测试只在行为有风险或组件交互复杂时补，不为简单样式组件机械加测试。

## 组件实现规范

- 基础交互优先基于 `@base-ui/react` 封装。
- class 合并使用 `cn`（`packages/ui/src/utils/cn.ts`）。
- 图标优先使用组件库已有 icons（`packages/ui/src/icons`），不手写 SVG。
- 变体命名使用语义，不使用视觉实现细节。
- 默认值必须和 `index.md` API 表一致。
- 组件 props 应该明确，不使用 `any` 承接公开 API。
- 内部调用方可以直接迁移，不新增兼容 shim。

新增或调整 `variant`、`size`、`tone` 等枚举前，必须先搜索现有同类组件，沿用既有语义，不创造平行命名。

避免把视觉实现细节暴露为公开 API，例如 `green`、`white`、`border`。纯图标按钮、全宽按钮等能力沿用现有组件模式（如 Button 的 `iconOnly`、`fullWidth`）：用明确行为建模，不污染尺寸语义。

### Props 必要性（默认不加，先证明需要）

加任何 prop 前必须先证明它真的有人需要，**默认不加**。宁可少而准，不要为"可能用得上"预留旋钮。每个候选 prop 逐条自检：

- **有真实需求吗（已接入或明确规划）？** 搜一遍 `packages/web` 等消费方确认场景。注意区分两种"暂无调用方"：组件**接入期**、有明确近期规划的 prop 是合理的，可以保留；而**纯臆测**、只有 demo / playground 会用到、又说不出落地场景的 prop，等于没人用，不要加。判断不清时，问一句"这个 prop 是规划要用，还是只是先占个位"。
- **能不能用 `className` 解决？** 宽度、间距、对齐等一次性视觉差异，交给调用方传 `className`（组件用 `cn` 合并），不要做成 `size`/`spacing` 这类枚举 prop。事实上调用方常用 `className` 覆盖内置枚举——这就是该 prop 不该存在的信号。
- **能不能由已有信息推导？** 能从其它 prop / context / 子结构推出来的，就不要再开一个并列 prop（避免 `size` 和 `layout` 互相打架这类组合爆炸）。
- **它是否制造内部复杂度？** 一个枚举 prop 若导致大量子组件出现 `prop === "x" ? ... : ...` 分支，要权衡这复杂度是否真有等价收益；没有就砍。

判断不准时，先不加；等出现第二个真实场景再抽象，好过先造一个没人用的 prop 再删。删除无用 prop 时按"不可妥协规则"直接改调用方，不留兼容。

## Tailwind Token 使用规则

`packages/ui/src/style.css` 的 `@theme` 是组件库 token 唯一事实源。

使用规则：

- 优先使用语义别名，而不是直接使用原始 ramp。
- 颜色优先使用 `paper`、`surface`、`ink`、`ink-soft`、`ink-deep`、`muted`、`muted-strong`、`accent`、`accent-strong`、`danger`、`danger-strong`、`panel`、`line`、`overlay` 等语义 token。
- 状态、开关、细节面板等场景优先搜索并复用已有 `notice-*`、`toggle-*`、`pane-*` 等 token。
- **绝不使用 Tailwind 默认调色板**（`red-* / emerald-* / sky-* / slate-*` 等）。需要某种状态色时，先在 `@theme` 找语义 token，没有就补一个语义 token（如 `danger`），不要用裸调色板顶替。
- 原始色阶 ramp（如 `brand-500`）只在组件明确需要表达品牌强度或色阶层级时直接使用。
- 圆角、阴影、字号、间距、动效同样以 `@theme` 为准，不在组件内自造值。

### 间距与密度判断

组件库的间距不是审美临场判断，必须先归入密度场景，再落到 `packages/ui/src/style.css` 的 spacing token。新增或修改 `px-*`、`py-*`、`p-*`、`gap-*`、`space-y-*`、`space-x-*`、`h-*`、`w-*`、`size-*`、`max-w-*` 等尺寸类之前，先回答它属于哪种场景：

- **compact**：表格操作、菜单项、弹窗 footer、metadata、行内工具。默认使用小按钮和紧凑 gap。
- **comfortable**：普通弹窗、popover、表单段落、局部配置面板。默认是组件库的常规密度。
- **spacious**：页面级卡片、详情页 section、营销/展示型区域。不要把这个密度带进弹窗和浮层。

硬规则：

- 弹窗、popover、dropdown、toast 等浮层默认不使用页面级大间距；如果出现接近 `space-8` / `space-9` 及以上的 padding/gap，必须先证明它不是页面 section 的误用。
- `layout` 只决定结构，不等于“大号模式”。例如 `dialog / panel / split` 可以改变列结构，但不应该顺手把标题、padding、footer、sidebar 全部放大。
- 组件默认密度应偏紧，服务后台管理台的高频扫描与重复操作；低频展示场景由调用方通过 `className` 放大，不为此新增 `density` / `spacing` 公开 prop。
- 多个子组件共享同一套间距时，必须抽到组件目录的 `style.ts`，并使用语义命名（例如 dialog section、footer、sidebar、content gap），不要在每个子组件里重复裸 class。
- Playground/demo 是组件契约的一部分。demo 内部的 `space-y-*`、`gap-*`、`p-*` 也必须服从组件密度，不能用随手的大留白塑造错误基准。
- 如果一个间距无法明确归类为 compact、comfortable 或 spacious，先不要加；回到组件职责和信息层级重新判断。

### 图标尺寸（spacing 刻度被重映射，必须读这条）

图标尺寸是密度规则的**例外**，单独走图标专用 token，不要套用文字或裸 spacing 刻度。两个坑必须避开：

- **不要用文字字号给图标定大小。** `text-*` 字号刻度是 11–15px（`text-base` 仅 13px），把图标缩到正文字号会让图标糊成一团。图标的视觉重量应大于正文，不跟随 `text-*`。
- **不要凭 Tailwind 直觉写 `size-4`。** `packages/ui/src/style.css` 的 `--spacing-*` 刻度被**重映射**过：`size-4 ≈ 8px`、`size-6 ≈ 16px`、`size-7 ≈ 20px`，与社区版 Tailwind 完全不同。按肌肉记忆写 `size-4` 会得到 8px 的极小图标，这正是图标偏小的根因。

硬规则：

- 图标字形统一使用 `size-icon-*` 语义 token（`size-icon-sm / size-icon-md / size-icon-lg`），具体像素值以 `style.css` 的 `--spacing-icon-*` 为准，本文不复制数值。
- 默认用 `size-icon-md`；行内/密集控件用 `size-icon-sm`；标题图标、空状态等强调场景用 `size-icon-lg`。
- 图标**容器**（按钮、头像位）仍走常规 spacing 密度判断；只有图标字形本身走 `size-icon-*`。容器内可用 `[&_svg]:size-icon-md` 统一约束子图标，避免依赖调用方自己传尺寸。
- 缺档位时先在 `@theme` 补 `--spacing-icon-*`，再用；不要在组件里写 `size-[18px]` 或裸 `size-5` 绕过。

如果设计确实需要新 token：

1. 先判断是否是组件库通用能力。
2. 再修改 `packages/ui/src/style.css` 的 `@theme`。
3. 同步检查现有组件是否可以复用该 token。
4. 不在单个组件里临时写任意值绕过 token 系统。
5. 不在本 skill 文档里维护 token 枚举清单，避免和 `style.css` 漂移。

## Demo 与 Playground 规范

每个组件至少提供一个 `demos/playground.tsx`。

Playground 必须覆盖组件的主要可变 props。**按组件实际 props 选取**，下面只是示例，没有的 prop 不要硬塞控件：

- `variant`
- `size`
- `disabled`
- `children`
- `value`
- `open`
- `tone`
- `fullWidth`

推荐写法（变体选项与默认值从现有同类组件沿用，不要凭空造）：

```tsx
const controls = useControls({
  variant: {
    options: existingVariantOptions,
    value: existingDefaultVariant,
  },
  disabled: false,
  children: "提交",
});
```

规则：

- 不要每个 demo 手写控制面板 UI。
- 不要为了摆放写大量临时样式。
- 每个 Playground demo 必须用 `StoryBook`（`packages/ui/src/Playground`）包裹，由 `StoryBook` 负责组件预览画布、网格背景、内边距和 Tweaks 面板。
- 组件 `index.md` 中的 dumi demo 默认使用 `<code src="./demos/playground.tsx" nopadding></code>`，去掉 dumi 外层 padding，避免 dumi 和 `StoryBook` 双重包裹。
- 如果发现 demo 顶到左上角，优先检查是否漏了 `StoryBook`，不要先移除 `nopadding`。
- Playground 已覆盖默认状态时，不再额外保留 Basic。
- 交互型组件（值可变：Input / Select / Slider / Switch 等）的 demo 必须使用 `value` + `onChange` / `onValueChange` 写回 `useSetControl(name, value)`，让预览区组件本身可操作并与 Tweaks 面板实时同步。禁止 `readOnly` + 受控值、`onChange={() => {}}` 这类冻结预览组件的写法；纯展示型组件不强加 `value` 控件。

## 文档规范

每个组件的 `index.md` 应包含：

```md
---
title: Button
group: 基础组件
description: 一句话说明组件用途。
---

# Button

简短说明组件用途和适用场景。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

| 属性 | 描述 | 类型 | 默认值 |
| ---- | ---- | ---- | ------ |
```

要求：

- 文档使用中文描述。
- API 表必须和 TypeScript props 一致。
- 默认值必须和组件实现一致。
- 删除旧 API 后，文档中不能继续出现旧概念。
- 组合组件按子组件拆 API，例如 `Dialog`、`AdminCard`。

## 校验流程

修改 `packages/ui` 后至少执行：

```bash
pnpm -F @clawbot/ui typecheck
pnpm -F @clawbot/ui fmt:check
pnpm -F @clawbot/ui lint
pnpm -F @clawbot/ui build
pnpm -F @clawbot/ui docs:build
```

如果同步修改了 `packages/web` 调用方，额外执行：

```bash
pnpm -F @clawbot/web typecheck
```

必须执行两条 token 违规扫描，两条都应为空（命中即需人工确认并修复，不能绕过）：

```bash
# 1. 任意值：绕过 token 的 magic value（bg-[#xxx]、text-[14px] 等）
rg -n '(^|\s)(bg|text|border|rounded|shadow|ring|p|px|py|m|mx|my|w|h|min-w|max-w|min-h|max-h|gap|space)-\[' packages/ui/src --glob '!*.md'

# 2. 默认调色板：绕过语义 token 的裸 Tailwind 颜色（red-700、emerald-500 等）
rg -n '\b(bg|text|border|ring|from|to|via|fill|stroke|outline|divide|decoration)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}\b' packages/ui/src --glob '!*.md'
```

扫描不是最终裁决，但命中结果必须人工判断是否合理；状态色命中默认调色板时，应改为语义 token。

## 输出期望

完成后，最终回复应说明：

- 修改了哪些组件文件。
- 是否新增或同步了 demo。
- 是否同步了 `index.md` API 表。
- 是否使用或新增了 token。
- 执行了哪些校验命令。
- 哪些校验未能执行以及原因。
