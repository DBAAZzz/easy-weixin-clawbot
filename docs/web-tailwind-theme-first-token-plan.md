# Web 端 Tailwind 主题优先（Theme-First）Token 方案

> **Review 日期：2026-04-12**
>
> 本文档经过代码库审计后补充了以下改进（原文保留，废弃部分已标注）：
>
> 1. 补充 Tailwind v4 `@theme` 具体语法和完整 token 字典（原方案仅有类目，无具体代码）
> 2. 明确 `@theme` 静态编译 vs `:root` 运行时变量的区别（原方案未区分）
> 3. 修正文件拆分策略，降低迁移风险（原方案建议拆 4 文件，改为单文件分段）
> 4. 补全缺失的 token 类别：动效 easing、duration、font-size（原方案遗漏）
> 5. 扩大 Phase 范围覆盖：补充 ToolsPage（80+ 任意值）、DashboardPage（60+ 任意值）、布局组件等
> 6. 明确 Semantic / Component Token 层的落地边界，避免过度抽象
> 7. 明确 lint 门禁的具体工具方案
> 8. 修正构建命令为 pnpm（项目使用 pnpm workspace）

## 1. 目标与边界

### 1.1 目标

- 使用 Tailwind 主题能力统一设计 token。
- 不改变当前视觉风格，只做抽象和复用。
- 让后续页面开发优先使用 token，而不是页面内任意值拼接。

### 1.2 非目标

- 不做 UI 重设计。
- 不调整页面信息架构。
- 不引入新的视觉语义（颜色、圆角、阴影保持现值）。

## 2. 设计原则（必须遵守）

1. 视觉零回归：token 只是“命名抽象”，不是“改值”。
2. 主题单一真源：Tailwind 主题层是唯一 token 来源。
3. 兼容渐进迁移：保留旧变量兼容层，避免一次性大改导致风险。
4. 先基础组件后业务页：先 `ui` 组件，再页面落地。
5. 禁止新增任意值：迁移后限制新增 `bg-[...]` / `text-[...]` / `rounded-[...]`。

## 3. 推荐落地结构（packages/web）

> ⚠️ **以下为废弃方案（拆分 4 文件）**——经审计发现，当前项目仅有 `src/styles.css` 单文件（164 行），
> 拆分会引入导入链变更风险，不符合"视觉零回归"原则。保留原文供参考，但执行时请用下方修正方案。

```txt
src/
  styles/
    index.css                # 入口样式，聚合 import
    theme.tokens.css         # Tailwind 主题 token（主真源）
    legacy-compat.css        # 兼容旧 CSS 变量映射（过渡期）
    base.css                 # reset、滚动条、全局背景、动画基础
  components/ui/
    button.tsx
    input.tsx
    badge.tsx
    admin-card.tsx
```

说明：

- 当前 `src/styles.css` 可拆分为上面 4 个文件，或保留单文件但按分段组织。
- 关键是 `theme.tokens.css` 成为 token 主真源。

### 3.1 修正方案：单文件分段组织（推荐）

保持 `src/styles.css` 不拆分，在文件内按注释分段组织：

```css
/* ===== 1. Imports ===== */
@import url("...");
@import "tailwindcss";

/* ===== 2. Theme Tokens (主真源) ===== */
@theme {
  /* 颜色、圆角、阴影、字体、动效 token 全部在此注册 */
}

/* ===== 3. Runtime Variables (运行时变量) ===== */
:root {
  /* 需要运行时计算的变量（如 rgba 透明色）放在这里 */
}

/* ===== 4. Base & Reset ===== */
/* html/body/scrollbar/selection 等 */

/* ===== 5. Animations ===== */
/* keyframes + utility classes */

/* ===== 6. Custom Components ===== */
/* .ui-skeleton, .status-dot 等 */
```

优势：

- 零导入链变更，不影响 `vite.config.ts` 和应用入口
- `@theme` 块天然成为 token 主真源
- 未来如需拆分，只需 `@import` 提取，向上兼容

### 3.2 UI 组件完整清单（补充）

原方案仅列出 4 个组件，实际代码库有 8 个：

```txt
components/ui/
  button.tsx          # 4 变体 (primary/outline/ghost/destructive)
  input.tsx           # 基础输入 + focus ring
  badge.tsx           # 5 tone (online/offline/muted/error/warning)
  admin-card.tsx      # CardActionButton/CardToggle/IconTag/MetricGrid
  card.tsx            # 基础卡片容器
  select.tsx          # 自定义下拉
  scroll-area.tsx     # 滚动容器
  icons.tsx           # SVG 图标（无需 token 化）
```

## 4. Token 分层模型

### 4.1 Foundation Token（原始值）

来源于现有视觉值（直接镜像）：

- 颜色：`ink`、`muted`、`line`、`accent`、`paper` 等
- 圆角：`8/10/12/18/28/30`
- 阴影：卡片、弹窗、按钮
- 字体：`sans`、`mono`
- 动效：标准 easing、duration

### 4.2 Semantic Token（语义值）

抽象页面语义，不绑定具体值：

- `surface/default|raised|overlay`
- `text/default|muted|inverse|danger`
- `border/default|strong|danger`
- `state/success|warning|error|info`

> ⚠️ **Semantic Token 层落地边界修正：**
>
> 经审计，当前代码库已有良好的语义命名（`--ink`、`--muted`、`--accent`、`--panel`、`--surface`），
> 基本覆盖了上述语义。第一阶段不应引入新的语义抽象层（如 `text/default` 替换 `ink`），
> 而应**优先将现有 CSS 变量注册为 `@theme` token**，让 `text-[var(--ink)]` 变为 `text-ink`。
>
> Semantic Token 层仅在以下场景补充：
> - 现有变量未覆盖的语义：`state/success|warning|error|info`（badge 里用 emerald/red/amber 硬编码）
> - `surface` 层级：当前 `--paper`/`--surface`/`--panel`/`--panel-strong` 已经是语义分层，直接注册即可

### 4.3 Component Token（组件级）

给基础组件消费：

- `btn/primary|outline|ghost`
- `input/default|focus`
- `badge/online|muted|warning|error`
- `card/entity|modal|panel`

> ⚠️ **Component Token 层落地边界修正：**
>
> 经审计，Button 已有完善的 `buttonClassName()` 变体函数，Badge 已有 `tone` 系统。
> 组件级 token 会与现有 JS 变体系统产生职责冲突。
>
> **修正策略：Component Token 层仅作为可选优化，第一阶段不实施。**
> 组件内部样式通过消费 Foundation / Semantic token 即可完成迁移，
> 无需额外建立 `btn/primary` 等 CSS token。

## 5. Theme-First 技术方案（Tailwind v4）

> 当前项目已启用 `@tailwindcss/vite`，可直接走 Tailwind v4 主题方案。

### 5.1 建立主题 token（主真源）

> ⚠️ **以下为废弃方案（仅有类目描述，缺少具体 `@theme` 语法和完整 token 字典）**，保留供参考。
> 执行时请使用下方 5.1.1 修正方案。

在 `theme.tokens.css` 使用 Tailwind v4 主题声明（建议）：

- 定义 color token（映射现有 `--ink`、`--muted`、`--accent`...）
- 定义 radius token（`--radius-8` 等）
- 定义 shadow token
- 定义 font token

要求：值与现有页面保持 1:1 一致，不改视觉。

#### 5.1.1 修正方案：完整 `@theme` 块（Tailwind v4 语法）

> **关键概念：** Tailwind v4 使用 `@theme {}` 在 CSS 中注册 token。注册后：
> - `--color-ink: #15202b` → 可直接使用 `text-ink`、`bg-ink`、`border-ink`
> - `--radius-card: 10px` → 可直接使用 `rounded-card`
> - `--shadow-card: ...` → 可直接使用 `shadow-card`
> - `--font-sans: ...` → 可直接使用 `font-sans`
>
> 注册后，`text-[var(--ink)]` 可以迁移为 `text-ink`，这是本方案的核心收益。

在 `src/styles.css` 的 `@import "tailwindcss"` 之后添加：

```css
@theme {
  /* ── Color: Foundation ── */
  --color-paper: #f4f7f8;
  --color-surface: #edf2f4;
  --color-ink: #15202b;
  --color-ink-soft: #233140;
  --color-muted: #667383;
  --color-muted-strong: #4b5969;
  --color-accent: #156e63;
  --color-accent-strong: #0f5b52;

  /* ── Color: State (badge.tsx 中硬编码的颜色提取) ── */
  --color-state-success: #22c55e;     /* emerald-500 */
  --color-state-error: #ef4444;       /* red-500 */
  --color-state-warning: #f59e0b;     /* amber-500 */

  /* ── Radius ── */
  --radius-sm: 6px;
  --radius-DEFAULT: 8px;
  --radius-md: 10px;
  --radius-lg: 12px;
  --radius-xl: 18px;
  --radius-2xl: 28px;
  --radius-pill: 30px;

  /* ── Shadow ── */
  --shadow-card: 0 1px 4px -1px rgba(15, 23, 42, 0.06);
  --shadow-card-hover: 0 8px 20px -12px rgba(15, 23, 42, 0.12);
  --shadow-btn: 0 1px 3px rgba(15, 23, 42, 0.2);
  --shadow-popover: 0 10px 24px -8px rgba(15, 23, 42, 0.18);

  /* ── Font Family ── */
  --font-sans: "Outfit", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
  --font-mono: "JetBrains Mono", "SFMono-Regular", "Menlo", "Monaco", monospace;

  /* ── Font Size (代码库中发现的自定义尺寸) ── */
  --text-2xs: 10px;
  --text-xs: 12px;
  --text-sm-: 13px;    /* 介于 xs 和 sm 之间 */

  /* ── Easing (全局统一缓动) ── */
  --ease-expo: cubic-bezier(0.16, 1, 0.3, 1);

  /* ── Duration ── */
  --duration-fast: 150ms;
  --duration-normal: 200ms;
  --duration-slow: 300ms;

  /* ── Animation ── */
  --animate-select-in: selectIn 0.18s var(--ease-expo);
  --animate-rise: rise 0.55s var(--ease-expo) forwards;
}
```

> **`@theme` 与 `:root` 的区别（必须理解）：**
>
> | | `@theme {}` | `:root {}` |
> |---|---|---|
> | 编译方式 | Tailwind 静态编译，生成 utility class | 浏览器运行时 CSS 变量 |
> | 用途 | 注册 Tailwind utility（`text-ink`、`rounded-card`） | runtime 计算值（rgba 透明色、JS 动态修改） |
> | 类名支持 | ✅ 自动生成 `text-ink`、`bg-ink` 等 | ❌ 必须用 `text-[var(--xxx)]` |
>
> **需要保留在 `:root` 中的变量**（含 rgba 透明值，Tailwind `@theme` 无法直接处理 opacity 通道复用）：
>
> ```css
> :root {
>   --panel: rgba(255, 255, 255, 0.78);
>   --panel-strong: rgba(255, 255, 255, 0.92);
>   --sidebar: rgba(247, 250, 251, 0.86);
>   --accent-soft: rgba(21, 110, 99, 0.1);
>   --line: rgba(21, 32, 43, 0.08);
>   --line-strong: rgba(21, 32, 43, 0.16);
> }
> ```
>
> 这些 rgba 变量可以同时在 `@theme` 中注册以获得 utility 支持：
> ```css
> @theme {
>   --color-panel: var(--panel);
>   --color-panel-strong: var(--panel-strong);
>   --color-sidebar: var(--sidebar);
>   --color-accent-soft: var(--accent-soft);
>   --color-line: var(--line);
>   --color-line-strong: var(--line-strong);
> }
> ```

### 5.2 兼容层（过渡）

> ⚠️ **以下为废弃方案（单独 legacy-compat.css 文件）**——按 3.1 修正方案，不再拆分文件。
> 兼容层改为在 `:root` 中直接保留旧变量名，无需单独文件。

在 `legacy-compat.css` 保留旧变量：

- 旧变量 `--ink`、`--line` 等继续可用。
- 其值改为引用主题 token（而不是写死数值）。

这样可以先迁组件，不会一次性影响所有页面。

#### 5.2.1 修正方案：`:root` 原地兼容

`@theme` 注册颜色后（如 `--color-ink: #15202b`），Tailwind 会自动生成 `--color-ink` CSS 变量。

旧代码中 `var(--ink)` 需要继续工作，因此在 `:root` 中保留旧变量并指向新 token：

```css
:root {
  /* 兼容层：旧变量 → 新 @theme token */
  --ink: var(--color-ink);
  --ink-soft: var(--color-ink-soft);
  --muted: var(--color-muted);
  --muted-strong: var(--color-muted-strong);
  --accent: var(--color-accent);
  --accent-strong: var(--color-accent-strong);
  --paper: var(--color-paper);
  --surface: var(--color-surface);
  /* rgba 变量保持原值（已在 :root 中定义） */
}
```

迁移完成后，旧变量可逐步删除。

### 5.3 统一 utility 使用规范

迁移后页面优先使用：

- 语义类（如 `text-ink`、`bg-surface`、`border-line`）
- 组件类（如 `btn-primary` 所在组件封装）

禁止在页面层继续引入新的大段任意值类。

## 6. 分阶段执行计划

## Phase 0：基线冻结（1 天）

- 选 6 个关键页面做视觉基线截图：
- `/model-config`
- `/scheduled-tasks`
- `/webhooks`
- `/mcp`
- `/tools`
- `/skills`
- 记录当前任意值使用统计（作为迁移 KPI）。

产出：

- baseline 截图集
- 统计报告（任意值数量）

> **Phase 0 补充：** 经审计，以下页面任意值密度极高但未在基线列表中，必须纳入：
>
> | 页面 | 任意值数量 | 优先级 |
> |------|-----------|--------|
> | ToolsPage | 80+ | 🔴 最高 |
> | DashboardPage | 60+ | 🔴 高 |
> | MemoryGraphPage | 40+ | 🟡 中 |
> | Sidebar.tsx (布局) | 35+ | 🟡 中 |
> | ProviderConfigPage | 25+ | 🟡 中 |
> | ObservabilityPage | 20+ | 🟢 低 |
>
> 建议 Phase 0 截图扩展到上述全部 12 个页面 + Sidebar 布局。

## Phase 1：主题 token 建立（1-2 天）

- 抽取 `styles.css` 中颜色、圆角、阴影、字体。
- 写入 `theme.tokens.css`。
- 建立 `legacy-compat.css` 映射旧变量。

产出：

- token 字典（foundation + semantic）
- 编译通过，视觉不变

## Phase 2：基础组件 token 化（1-2 天）

改造以下组件，仅替换 token 引用，不改交互：

- `components/ui/button.tsx`
- `components/ui/input.tsx`
- `components/ui/badge.tsx`
- `components/ui/admin-card.tsx`
- `components/ui/card.tsx`（如涉及）

产出：

- 基础组件不再依赖散落任意值
- 页面视觉无明显变化

> **Phase 2 补充：完整组件清单 + 迁移示例**
>
> 缺失组件需纳入：
> - `components/ui/select.tsx`
> - `components/ui/scroll-area.tsx`
>
> **核心迁移模式（所有组件遵循）：**
>
> ```diff
> // button.tsx 迁移示例
> - "border-[var(--ink)] bg-[var(--ink)] text-white shadow-[0_1px_3px_rgba(15,23,42,0.2)]"
> + "border-ink bg-ink text-white shadow-btn"
>
> // input.tsx 迁移示例
> - "border-[var(--line-strong)] bg-[rgba(255,255,255,0.82)] focus:ring-[rgba(21,110,99,0.14)]"
> + "border-line-strong bg-panel focus:ring-accent-soft"
>
> // 通用 easing 迁移
> - "ease-[cubic-bezier(0.16,1,0.3,1)]"
> + "ease-expo"
> ```
>
> **badge.tsx 特殊处理：** 当前硬编码 emerald/red/amber 颜色需映射到 `state-success`/`state-error`/`state-warning` token。

## Phase 3：高频页面迁移（2-4 天）

优先迁移：

- `ModelConfigPage`
- `ScheduledTasksPage`
- `WebhooksPage`
- `McpPage`

策略：

- 只替换样式引用方式（token 化），不改布局信息层级。
- 保留类名结构，避免行为回归。

> **Phase 3 补充：缺失页面和布局组件必须纳入**
>
> 原方案仅覆盖 4 个页面，但 **ToolsPage（80+任意值）和 DashboardPage（60+任意值）是最严重的**，
> 不迁移等于方案失效。建议分两批：
>
> **Phase 3a（高密度优先）：**
> - `ToolsPage`（80+ 任意值，最严重）
> - `DashboardPage`（60+ 任意值）
> - `ModelConfigPage` + `ProviderConfigPage`
> - `ScheduledTasksPage`
> - `WebhooksPage` + `WebhookLogsPage`
>
> **Phase 3b（布局 + 其余页面）：**
> - `layout/Sidebar.tsx`（35+ 任意值，影响全局）
> - `layout/AppShell.tsx`
> - `SkillsPage`
> - `McpPage`
> - `MemoryGraphPage`
> - `ObservabilityPage` + `ObservabilityTracePage`
> - `ConversationPage`
> - `AuthLoginPage` / `LoginPage`

## Phase 4：规范门禁（1 天）

- 增加 lint/脚本，禁止新增任意值类（白名单机制）。
- PR 模板增加检查项：
- 是否新增任意值类
- 是否使用 token 语义类
- 是否通过视觉对比

> **Phase 4 补充：具体 lint 工具方案**
>
> Tailwind 没有内置任意值 linter。推荐以下方案：
>
> **方案 A（推荐）：自定义 grep 脚本**
>
> 在 `package.json` 中添加：
> ```json
> {
>   "scripts": {
>     "lint:arbitrary": "grep -rnE '(bg|text|border|rounded|shadow|ring|gap|p|m|w|h)-\\[' src/ --include='*.tsx' --include='*.ts' | grep -v 'node_modules' | grep -v '// token-exempt'"
>   }
> }
> ```
>
> CI 中运行 `pnpm lint:arbitrary`，输出不为空则失败。
> 对确需任意值的地方，加 `// token-exempt` 注释白名单。
>
> **方案 B：ESLint + eslint-plugin-tailwindcss**
>
> ```bash
> pnpm add -D eslint-plugin-tailwindcss
> ```
>
> 配置 `no-arbitrary-value` 规则（需确认插件对 Tailwind v4 的支持情况）。

## 7. 验收标准（Definition of Done）

1. `npm run build` 通过。
2. `npm run fmt:check` 通过。
3. 关键页面视觉回归可接受（建议像素差异 < 1%）。
4. 基础 UI 组件全部消费 token，不再直接写死颜色值。
5. 新增代码中任意值类为 0（白名单除外）。

> **验收标准修正：**
>
> - 第 1、2 条命令应为 `pnpm run build` 和 `pnpm run fmt:check`（项目使用 pnpm workspace）
> - 补充第 6 条：`pnpm lint:arbitrary` 输出为空（任意值门禁通过）
> - 补充第 7 条：所有 `ease-[cubic-bezier(...)]` 已替换为 `ease-expo`
> - 补充第 8 条：所有 `text-[var(--xxx)]`、`bg-[var(--xxx)]` 已替换为直接 utility（`text-xxx`、`bg-xxx`）

## 8. 风险与应对

- 风险：一次性替换过多导致视觉抖动。  
  应对：分阶段，先组件后页面，阶段性截图对比。

- 风险：旧变量和新 token 混用过久导致双轨维护。  
  应对：设定兼容层截止时间，按页面批次清理。

- 风险：其他 AI 在迁移中顺手“优化 UI”。  
  应对：明确“禁止改视觉”，PR 描述必须包含“仅 token 抽象”声明。

## 9. 给其他 AI 的执行指令（可直接复制）

> ⚠️ **以下为废弃指令**——引用了废弃的文件拆分方案和不完整的页面范围。保留供参考，执行时请用下方 9.1 修正指令。

```txt
请在 packages/web 执行 Tailwind Theme-First token 抽象，要求"视觉不变，只抽象复用"：
1) 建立 src/styles/theme.tokens.css，抽取现有 styles.css 的颜色/圆角/阴影/字体 token。
2) 建立 src/styles/legacy-compat.css，将旧 CSS 变量映射到新 token，保证兼容。
3) 优先改造基础组件：button/input/badge/admin-card，改为消费 token。
4) 再迁移页面：model-config、scheduled-tasks、webhooks、mcp，仅替换样式引用，不改布局与交互。
5) 增加检查脚本，禁止新增任意值类（白名单除外）。
6) 每阶段执行 npm run build 与 npm run fmt:check，最后输出视觉对比与变更清单。
```

### 9.1 修正指令（请用此版本）

```txt
请在 packages/web 执行 Tailwind Theme-First token 抽象，要求"视觉不变，只抽象复用"。

## 核心原则
- 禁止改视觉、改布局、改交互
- 禁止拆分 styles.css 为多个文件
- 禁止引入新的 UI 设计或组件
- 只做样式引用方式的替换（任意值 → token utility）

## 第一步：在 src/styles.css 中添加 @theme 块

在 `@import "tailwindcss"` 之后、`:root` 之前，添加 @theme 块。

参考 docs/web-tailwind-theme-first-token-plan.md 中 5.1.1 节的完整 @theme 字典，
包含：颜色 token（--color-ink, --color-accent 等）、圆角（--radius-*）、
阴影（--shadow-*）、字体（--font-*）、字号（--text-*）、缓动（--ease-expo）、
时长（--duration-*）、动画（--animate-*）。

同时在 :root 中保留 rgba 变量（--panel, --line 等），并添加兼容映射
（--ink: var(--color-ink) 等），让旧代码继续工作。

## 第二步：改造所有 UI 组件

按优先级改造 components/ui/ 下全部组件：
  button.tsx、input.tsx、badge.tsx、admin-card.tsx、card.tsx、select.tsx、scroll-area.tsx

核心替换模式：
  text-[var(--ink)] → text-ink
  bg-[var(--accent)] → bg-accent
  border-[var(--line)] → border-line
  ease-[cubic-bezier(0.16,1,0.3,1)] → ease-expo
  shadow-[0_1px_3px_rgba(15,23,42,0.2)] → shadow-btn
  rounded-[10px] → rounded-md（按 @theme 注册的 radius token）

## 第三步：迁移全部页面（按任意值密度排序）

1. ToolsPage（80+）→ 2. DashboardPage（60+）→ 3. MemoryGraphPage（40+）
→ 4. Sidebar.tsx + AppShell.tsx（布局）→ 5. ModelConfigPage + ProviderConfigPage
→ 6. ScheduledTasksPage → 7. WebhooksPage + WebhookLogsPage
→ 8. SkillsPage → 9. McpPage → 10. ObservabilityPage
→ 11. ConversationPage → 12. AuthLoginPage + LoginPage

同样只替换样式引用方式，不改布局与交互。

## 第四步：添加 lint 门禁

在 package.json 中添加 lint:arbitrary 脚本（grep 检查任意值类）。
确需任意值处加 // token-exempt 注释白名单。

## 每步验证

每完成一个文件后执行 pnpm run build，确保编译通过。
全部完成后执行 pnpm run fmt:check。
输出变更清单：替换了多少个任意值、剩余多少个（白名单）。
```

## 10. 代码库现状审计（2026-04-12）

供执行者参考的现状快照：

### 10.1 任意值类型分布

| 类型 | 占比 | 示例 | 迁移方式 |
|------|------|------|----------|
| CSS 变量引用 `[var(--xxx)]` | ~60% | `text-[var(--ink)]` | → `text-ink`（`@theme` 注册后直接可用） |
| 硬编码 RGBA | ~25% | `bg-[rgba(21,110,99,0.08)]` | → 提取为 token 或 `:root` 变量 |
| 像素尺寸 | ~10% | `rounded-[10px]`、`text-[12px]` | → `rounded-md`、`text-xs`（`@theme` 注册后） |
| cubic-bezier | ~3% | `ease-[cubic-bezier(0.16,1,0.3,1)]` | → `ease-expo` |
| calc 表达式 | ~2% | `max-h-[calc(100dvh-2rem)]` | → 保留（白名单），calc 无法 token 化 |

### 10.2 `:root` 变量现状

已定义 18 个变量（均可迁移到 `@theme`）：

```
--font-sans, --font-mono
--paper, --surface, --panel, --panel-strong, --sidebar
--ink, --ink-soft, --muted, --muted-strong
--accent, --accent-strong, --accent-soft
--line, --line-strong
```

### 10.3 未被 CSS 变量覆盖的硬编码色值（需新增 token）

| 场景 | 硬编码值 | 建议 token 名 |
|------|---------|---------------|
| badge online | `emerald-*` | `--color-state-success` |
| badge error | `red-*` | `--color-state-error` |
| badge warning | `amber-*` | `--color-state-warning` |
| destructive button | `rgb(185,28,28)` 系列 | `--color-danger` + `--color-danger-soft` |
| focus ring | `rgba(21,110,99,0.14)` | `--color-ring-accent`（或复用 `--accent-soft`） |
| 各处半透明背景 | `rgba(255,255,255,0.82)` 等 | 归并到 `--panel` 系列 |

### 10.4 页面任意值密度排名

| 排名 | 页面/组件 | 任意值数量 |
|------|----------|-----------|
| 1 | ToolsPage.tsx | 80+ |
| 2 | DashboardPage.tsx | 60+ |
| 3 | MemoryGraphPage.tsx | 40+ |
| 4 | Sidebar.tsx | 35+ |
| 5 | UI 组件（合计） | 25+ |
| 6 | ObservabilityPage.tsx | 20+ |
| 7-15 | 其余页面 | 10-20 |

