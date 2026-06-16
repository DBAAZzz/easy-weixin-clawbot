# UI 组件库 Skill 设计

## 目标

`.agent/skills/ui-design/SKILL.md` 应该成为 `packages/ui` 组件库开发的执行契约，而不是泛化的 UI 审美指南。

它的职责是约束 AI 在新增、重构、修改组件时遵循组件库的事实源：设计令牌、组件目录结构、dumi 文档、Playground demo 和验证流程。

## 触发场景

`SKILL.md` 必须用 frontmatter 明确触发边界，不能只在正文里描述。

推荐 `ui-design` frontmatter：

```yaml
---
name: ui-design
description: Clawbot UI 组件库开发规范。仅当任务涉及 packages/ui、@clawbot/ui 组件、组件设计 token、dumi 文档、demo 或 Playground 时使用。不要用于 packages/web 业务页面或业务组件。
---
```

同时应收窄 `web-design` 的 frontmatter，避免和组件库 skill 抢触发：

```yaml
---
name: web-design
description: Clawbot Web 业务前端设计规范。仅当任务涉及 packages/web 下的业务页面、业务组件、布局、样式或交互时使用。不要用于 packages/ui 组件库、dumi 文档、组件 token 或 Playground。
---
```

当任务涉及以下内容时使用 `ui-design`：

- 新增 `packages/ui` 组件。
- 修改已有组件 API、样式、交互或组合结构。
- 编写或调整组件 `index.md` 文档。
- 编写或调整 `demos/playground.tsx`。
- 调整组件对 Tailwind token 的使用。
- 修改组件后执行构建、类型检查、格式化和文档站验证。

该 skill 不负责业务页面设计，也不替代 `web-design`。业务页面应继续遵循 `packages/web` 和项目级 AGENTS 约束。

## 不可妥协规则

1. 组件必须使用 `packages/ui/src/style.css` 中定义的 Tailwind token。
2. 禁止随手使用 Tailwind 任意值，例如 `bg-[#xxx]`、`text-[14px]`、`rounded-[10px]`、`shadow-[...]`。
3. 禁止在组件内部散落 magic number。颜色、字号、圆角、阴影、动效优先来自 token class。
4. 组件 API 必须干净稳定，不为内部历史调用保留旧命名兼容。
5. 如果旧概念已经不符合组件模型，应直接删除并同步更新调用方。
6. demo 和文档是组件契约的一部分，不能只改实现不改文档。
7. 默认不保留 Basic demo；Playground 能覆盖时只保留 Playground。
8. 写完必须跑校验，不能只凭视觉或主观判断收尾。

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

复杂组件可以增加：

```txt
Component/
  type.ts
  context.tsx
  style.ts
  SubComponent.tsx
  Component.test.tsx
```

规则：

- `index.ts` 只做导出。
- 类型多且对外可见时放到 `type.ts`。
- 子组件数量较多时拆文件，不把所有实现塞进一个大文件。
- 测试只在行为有风险或组件交互复杂时补，不为简单样式组件机械加测试。

## 组件实现规范

组件实现应遵循：

- 基础交互优先基于 `@base-ui/react` 封装。
- class 合并使用 `cn`。
- 图标优先使用组件库已有 icons，不手写 SVG。
- 变体命名使用语义，不使用视觉实现细节。
- 默认值必须和 `index.md` API 表一致。
- 组件 props 应该明确，不使用 `any` 承接公开 API。
- 内部调用方可以直接迁移，不新增兼容 shim。

新增或调整 `variant`、`size`、`tone` 等枚举前，必须先搜索现有同类组件，沿用既有语义，不创造平行命名。

避免把视觉实现细节暴露为公开 API，例如 `green`、`white`、`border`。纯图标按钮、全宽按钮等能力沿用现有组件模式：用明确行为建模，不污染尺寸语义。

## Tailwind Token 使用规则

`packages/ui/src/style.css` 的 `@theme` 是组件库 token 唯一事实源。

使用规则：

- 优先使用语义别名，而不是直接使用原始 ramp。
- 颜色优先使用 `paper`、`surface`、`ink`、`ink-soft`、`ink-deep`、`muted`、`muted-strong`、`accent`、`accent-strong`、`panel`、`line`、`overlay` 等语义 token。
- 状态、开关、细节面板等场景优先搜索并复用已有 `notice-*`、`toggle-*`、`pane-*` 等 token。
- 原始色阶 ramp 只在组件明确需要表达品牌强度或色阶层级时直接使用。
- 圆角、阴影、字号、动效同样以 `@theme` 为准，不在组件内自造值。

如果设计确实需要新 token：

1. 先判断是否是组件库通用能力。
2. 再修改 `packages/ui/src/style.css` 的 `@theme`。
3. 同步检查现有组件是否可以复用该 token。
4. 不在单个组件里临时写任意值绕过 token 系统。
5. 不在 skill 文档里维护 token 枚举清单，避免和 `style.css` 漂移。

## Demo 与 Playground 规范

每个组件至少提供一个 `demos/playground.tsx`。

Playground 必须覆盖组件的主要可变 props，例如：

- `variant`
- `size`
- `disabled`
- `children`
- `value`
- `open`
- `tone`
- `fullWidth`

推荐写法：

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
- 每个 Playground demo 必须用 `StoryBook` 包裹，由 `StoryBook` 负责组件预览画布、网格背景、内边距和 Tweaks 面板。
- 组件 `index.md` 中的 dumi demo 默认使用 `<code src="./demos/playground.tsx" nopadding></code>`，去掉 dumi 外层 padding，避免 dumi 和 `StoryBook` 双重包裹。
- 如果发现 demo 顶到左上角，优先检查是否漏了 `StoryBook`，不要先移除 `nopadding`。
- Playground 已覆盖默认状态时，不再额外保留 Basic。

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
pnpm -F @clawbot/web exec tsc --noEmit
```

建议执行 token 违规扫描：

```bash
rg -n '(^|\s)(bg|text|border|rounded|shadow|p|px|py|m|mx|my|w|h|min-w|max-w|min-h|max-h)-\[' packages/ui/src
```

该扫描不是最终裁决，但命中结果必须人工判断是否合理。

## Skill 输出期望

AI 使用该 skill 后，最终回复应说明：

- 修改了哪些组件文件。
- 是否新增或同步了 demo。
- 是否同步了 `index.md` API 表。
- 是否使用或新增了 token。
- 执行了哪些校验命令。
- 哪些校验未能执行以及原因。

## 设计判断

这个 skill 应该偏命令式，而不是建议式。组件库开发的关键问题不是“有没有灵感”，而是 AI 很容易绕过设计系统、跳过文档、保留错误兼容、写完不验证。

因此该 skill 的核心价值是把组件库贡献流程固定下来：先遵循 token，再实现组件，再写 Playground，再写 API 文档，最后跑校验。
