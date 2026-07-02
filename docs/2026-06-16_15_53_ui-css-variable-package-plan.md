# @clawbot/ui 预构建 CSS 与 CSS 变量发布方案

## 背景

当前 `@clawbot/ui` 组件库使用 Tailwind v4 `@theme` token，并在组件内消费类似 `bg-button-primary`、`h-button-md` 的主题类名。这种模式适合 monorepo 内部开发，但不适合作为独立 npm 包发布。

主要问题：

- 消费方必须通过相对路径导入 `packages/ui/src/tokens.css`，生产构建和外部包消费不可依赖源码路径。
- 消费方必须使用 Tailwind v4，并且构建管线要能处理第三方 `@theme`。
- 每个消费系统都要重复声明或重新处理语义色板，主题边界容易冲突。
- UI 包的样式契约绑定在 Tailwind 编译期，而不是稳定的运行时 CSS 变量。

## 目标

1. `@clawbot/ui` 具备独立 npm 包发布能力。
2. 消费方只需要 import 一个预构建 CSS 文件即可获得组件样式。
3. 消费方不需要使用 Tailwind，也不需要扫描 `node_modules` 或重新处理 `@theme`。
4. 主题通过覆盖 CSS 自定义属性完成，组件样式通过 `var()` 与主题通信。
5. 组件样式仍然保留现有语义 token、组件 token 和密度规则，不回退到 magic number。

当前 `packages/ui/package.json` 仍是 `"private": true`。因此本方案分两层落地：

- 第一层：先在 monorepo 内建立包名入口和预构建 CSS 边界，消除 `../../ui/src/...` 源码路径依赖。
- 第二层：需要真正发布 npm 时，再移除 `private`，补齐 `publishConfig`、`repository`、版本策略和发布流程。

## 非目标

- 不重设计组件视觉。
- 不改变组件公开 API。
- 不引入 Tailwind 任意值语法作为长期方案。
- 不要求消费方继承 ClawBot Web 的完整页面主题。

## 核心决策

采用 **预构建 CSS + 纯 CSS 变量 + 稳定全局 class 前缀**。

不采用 Tailwind 任意值轻量改造，例如 `bg-(--color-button-primary)`。这种写法仍要求消费方使用 Tailwind v4 并扫描组件源码或包产物，没有真正解决独立发布问题。

也不优先采用 CSS Modules。CSS Modules 本身可行，但会要求 `tsdown` 或 Vite library mode 处理 CSS 模块映射，迁移复杂度更高。当前更稳的路径是使用带前缀的全局 class：

```css
.cb-button {}
.cb-button--primary {}
.cb-button--md {}
```

组件 CSS 必须放入命名 layer，避免外部样式覆盖行为依赖加载顺序：

```css
@layer clawbot {
  .cb-button {
    /* ... */
  }
}
```

非 layer 的消费方 CSS 会天然覆盖 layer 内组件样式。消费方如果使用 Tailwind，自己的 utility 也应在组件 CSS 之后或非 `clawbot` layer 中生成。`className` 主要用于布局、宽度和局部覆盖；组件视觉变体仍优先由组件 props 和 CSS 变量表达。

## CSS 分层

最终 CSS 分为三层：默认主题、组件 token、组件样式。

### 默认主题：`packages/ui/src/style.css`

`style.css` 是推荐消费入口。它聚合默认主题、组件 token 和组件 CSS。

```css
@import "./tokens.css";
@import "./Button/button.css";
@import "./Toggle/toggle.css";
@import "./Select/select.css";

:root {
  color-scheme: light;

  /* Palette ramps */
  --color-brand-50: #e9f5ef;
  --color-brand-500: #1d6e54;
  --color-claw-25: #fafbfc;
  --color-claw-900: #1a2128;

  /* Semantic defaults */
  --color-accent: var(--color-brand-500);
  --color-accent-strong: #185b46;
  --color-ink: var(--color-claw-900);
  --color-paper: var(--color-claw-25);
  --color-line: rgba(26, 33, 40, 0.08);
}
```

色板 ramp 仍保留在 `:root` 中，供需要精确取色的组件、文档和消费方使用。

暗色模式不纳入第一阶段迁移。当前 `.dumirc.ts` 开启了 `prefersColor.switch`，迁移时必须先保证 light 主题的组件和文档站不回归；如果要保留 docs 暗色切换，应在后续阶段通过独立覆盖层实现，例如：

```css
:root[data-prefers-color="dark"],
html[data-prefers-color="dark"] {
  --color-paper: #11171c;
  --color-ink: #fafbfc;
}
```

不要把 dark token 混入第一阶段的 CSS 变量结构迁移，否则会同时扩大视觉验证范围。

### 组件 token：`packages/ui/src/tokens.css`

`tokens.css` 不再包含 `@import "tailwindcss"` 和 `@theme`。它只声明标准 CSS 变量。

组件 token 可以引用语义 token，并提供兜底值：

```css
:root {
  /* Structural tokens */
  --spacing-button-md: 40px;
  --spacing-button-sm: 32px;
  --spacing-button-md-x: 24px;
  --spacing-button-md-gap: 12px;

  /* Component color tokens */
  --color-button-primary: var(--color-accent, #1d6e54);
  --color-button-primary-hover: var(--color-accent-strong, #185b46);
  --color-button-primary-fg: #ffffff;
}
```

约束：

- 结构 token 放在 `tokens.css`，例如 spacing、尺寸、组件局部间距。
- 组件色彩 token 放在 `tokens.css`，但必须优先引用语义 token。
- 语义 token、palette ramp、字体、字号、字距、行高、圆角、阴影和动效默认值放在 `style.css` 的默认主题里。
- 消费方换肤时优先覆盖语义 token，例如 `--color-accent`，不要重复声明 `--color-button-primary`。

命名说明：现有 token 使用 `--spacing-button-md` 表示按钮高度。迁移时可以先沿用，降低改动面；若要重命名为 `--size-button-md`，必须作为单独 breaking token 迁移处理，并同步所有组件和文档。

### 待迁移 token checklist

迁移不是只搬 spacing 和颜色。当前 `@theme` 中的所有非 Tailwind 默认 token 都必须落到运行时 CSS 变量，否则组件 CSS 里的 `var(--shadow-btn)`、`var(--ease-expo)`、`var(--font-sans)` 会解析为空。

归属规则：

- **结构 token**：纯尺寸、间距、组件几何，放 `tokens.css`。
- **组件色彩 token**：组件局部颜色语义，放 `tokens.css`，但值必须引用 `style.css` 的语义 token。
- **主题 token**：palette、语义颜色、字体、字号、字距、行高、圆角、阴影、动效，放 `style.css`。
- **阴影 token**：即使命名不是 `--color-*`，只要包含 `rgba()` 或主题色彩，就属于主题 token，放 `style.css`，不要当作结构 token 塞进 `tokens.css`。

必须迁移的 token 类别：

| 类别 | 归属 | 示例 | 说明 |
| --- | --- | --- | --- |
| Palette ramp | `style.css` | `--color-brand-50`、`--color-claw-900` | 默认主题色阶 |
| Semantic color | `style.css` | `--color-accent`、`--color-ink`、`--color-line` | 消费方主要覆盖点 |
| Component color | `tokens.css` | `--color-button-primary`、`--color-toggle-accent-solid` | 引用 semantic color |
| Spacing scale | `tokens.css` | `--spacing-1` 到 `--spacing-13` | 组件运行时尺寸；docs/web 如需 Tailwind utility 需另行注册 `@theme` |
| Component geometry | `tokens.css` | `--spacing-dialog-x`、`--spacing-select-popup-max-h` | 组件局部尺寸 |
| Icon size | `tokens.css` | `--spacing-icon-sm`、`--spacing-icon-md`、`--spacing-icon-lg` | 图标专用尺寸 |
| Radius | `style.css` | `--radius-card`、`--radius-panel`、`--radius-dialog` | 主题视觉圆角 |
| Shadow | `style.css` | `--shadow-btn`、`--shadow-card`、`--shadow-modal`、`--shadow-focus-accent` | 包含颜色，应归入主题层 |
| Font family | `style.css` | `--font-sans`、`--font-mono` | 默认字体族 |
| Font size | `style.css` | `--text-xs` 到 `--text-5xl` | 组件字号 |
| Line height | `style.css` | `--leading-tight`、`--leading-relaxed` | 组件正文和标题行高 |
| Letter spacing | `style.css` | `--tracking-badge`、`--tracking-body`、`--tracking-heading` | 标签、标题、正文 |
| Motion | `style.css` | `--ease-expo` | transition timing |

迁移验收时需要逐项确认：旧 `@theme` 中每一个自定义 token 都能在 `style.css` 或 `tokens.css` 的 `:root` 中找到对应声明。

### 组件样式：组件目录内 CSS

每个组件增加普通 CSS 文件，例如：

```txt
packages/ui/src/Button/
  Button.tsx
  button.css
  style.ts
  type.ts
```

`button.css` 示例：

```css
@layer clawbot {
  .cb-button {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: var(--radius-card, 10px);
    font-family: var(--font-sans, inherit);
    font-weight: 500;
    transition:
      background-color 0.2s,
      border-color 0.2s,
      color 0.2s,
      box-shadow 0.2s;
  }

  .cb-button--primary {
    background: var(--color-button-primary);
    color: var(--color-button-primary-fg);
  }

  .cb-button--primary:hover {
    background: var(--color-button-primary-hover);
  }

  .cb-button--md {
    min-height: var(--spacing-button-md);
    padding-inline: var(--spacing-button-md-x);
    gap: var(--spacing-button-md-gap);
    font-size: var(--text-base, 13px);
  }
}
```

`Button.tsx` 不应删除公开的 style helper。当前 `buttonClassName`、`toggleClassName`、`toggleGroupClassName`、`selectTriggerSizeClassName`、`cardActionButtonClassName` 等通过 `index.ts` 暴露，已经属于公开 API。迁移时有两种选择：

1. 保留 helper，改为返回 `cb-*` class 字符串。
2. 明确做 breaking change，文档和调用方同步删除这些导出。

默认采用第一种，避免违反“不改变组件公开 API”的非目标：

```ts
export function buttonClassName(options: ButtonClassNameOptions = {}) {
  const { variant = "primary", size = "md", fullWidth, iconOnly, className } = options;

  return cn(
    "cb-button",
    `cb-button--${variant}`,
    `cb-button--${size}`,
    fullWidth && "cb-button--full-width",
    iconOnly && "cb-button--icon-only",
    className,
  );
}
```

组件实现继续调用 helper：

```tsx
export function Button({ variant = "primary", size = "md", className, ...props }) {
  return <button className={buttonClassName({ variant, size, className })} {...props} />;
}
```

## 构建与发布

`@clawbot/ui` 的 npm 包必须发布预构建 CSS，且 `dist/style.css` 必须是已经内联 `@import` 的完整 CSS 文件。不能只是把 `src/style.css` 复制到 `dist/style.css`，否则 `@import "./Button/button.css"` 会在消费方解析失败。

当前落地采用本地构建脚本 `packages/ui/scripts/bundle-css.mjs`。它只内联 UI 包内部的相对 CSS `@import`，产出 `dist/style.css` 和 `dist/tokens.css`，并在 `dist/index.mjs` 缺少 CSS side-effect import 时补回 `import "./style.css";`。

构建脚本：

```json
{
  "scripts": {
    "build": "tsdown && node scripts/bundle-css.mjs && cp src/sonner.css dist/sonner.css"
  }
}
```

后续可以替换为 `lightningcss` 或启用 `@tsdown/css`，但替换方案必须满足同一条件：`dist/style.css` 不含悬空相对 `@import`，且 `dist/index.mjs` 能解析到 `./style.css`。

### JS side effect CSS 的关系

当前 `packages/ui/src/index.ts` 如果保留 `import "./style.css"`，则存在两种消费模式：

```tsx
// 自动样式：import 组件时由 JS side effect 引入 CSS
import { Button } from "@clawbot/ui";

// 显式样式：应用入口自己引入 CSS
import "@clawbot/ui/style.css";
```

推荐发布策略：

- `index.mjs` 可以保留 `import "./style.css"`，方便默认使用。
- 仍然保留 `./style.css` export，供 SSR、样式顺序控制、非 JS bundler 或显式导入场景使用。
- 必须确认 `dist/index.mjs` 中的 CSS import 指向 `./style.css`，而不是源码路径或未处理的 CSS。
- 文档中推荐 Web 端显式 `@import "@clawbot/ui/style.css"`，因为 Web 需要控制默认主题和覆盖变量的层叠顺序。

`@clawbot/ui` 的包配置建议为：

```json
{
  "files": ["dist"],
  "sideEffects": ["*.css", "**/*.css"],
  "exports": {
    ".": {
      "types": "./dist/index.d.mts",
      "import": "./dist/index.mjs",
      "default": "./dist/index.mjs"
    },
    "./style.css": "./dist/style.css",
    "./tokens.css": "./dist/tokens.css",
    "./sonner.css": "./dist/sonner.css"
  }
}
```

产物清单：

```txt
dist/
  index.mjs
  index.d.mts
  style.css
  tokens.css
  sonner.css
```

`sonner.css` 当前已有独立 export 和复制脚本。迁移时要么继续作为独立 CSS 入口保留，要么并入 `style.css` 后保留兼容 export；不能在构建产物清单里遗漏。

如果未来引入通用 CSS bundler，`scripts/bundle-css.mjs` 应删除，而不是和新 bundler 双轨并存。

## 文档站隔离

dumi 文档站不能继续把对外 `style.css` 当作 Tailwind 编译入口。

当前文档站依赖：

- `.dumirc.ts` 的 `extraPostCSSPlugins: [tailwindcss()]`。
- `global.css` 导入 `style.css`。
- Playground、demo、dumi theme 内大量 Tailwind layout class。
- `style.css` 中的 `@import "tailwindcss"` 和 `@source "./**/*.{ts,tsx,md}"`。

如果直接从 `style.css` 删除 Tailwind 入口，`docs:build` 会失去 demo 布局样式。因此需要拆分：

```txt
packages/ui/src/style.css              # 对外发布入口，纯 CSS 变量 + 组件 CSS
packages/ui/.dumi/docs-tailwind.css    # docs 专用 Tailwind 入口
packages/ui/src/docs-theme.css         # 可选：docs 站额外布局样式
```

`docs-tailwind.css` 可以保留：

```css
@import "tailwindcss";
@import "../src/style.css";

@source "../src/**/*.{ts,tsx,md}";
@source "./theme/**/*.{ts,tsx}";
@source "../docs/**/*.md";

@theme {
  /* Docs needs compile-time utilities for demo layout and demo colors.
     These are compile-time registrations; keep values in sync with src/style.css
     and src/tokens.css. Do not write self-references like --color-ink: var(--color-ink). */
  --spacing-0: 0;
  --spacing-1: 2px;
  --spacing-2: 4px;
  --spacing-3: 6px;
  --spacing-4: 8px;
  --spacing-5: 12px;
  --spacing-6: 16px;
  --spacing-7: 20px;
  --spacing-8: 24px;
  --spacing-9: 32px;
  --spacing-10: 40px;
  --spacing-11: 48px;
  --spacing-12: 64px;
  --spacing-13: 80px;

  /* Component geometry used directly by demos */
  --spacing-accordion-content-padding: var(--spacing-6);
  --spacing-admin-card-demo-description-gap: var(--spacing-3);
  --spacing-dialog-code-padding: var(--spacing-5);
  --spacing-scroll-area-demo-width: 520px;
  --spacing-scroll-area-demo-height: 240px;
  --spacing-scroll-area-content-padding: var(--spacing-6);
  --spacing-scroll-area-content-gap: var(--spacing-4);

  --color-ink: #1a2128;
  --color-muted: #8a949c;
  --color-muted-strong: #4a535b;
  --color-accent: #1d6e54;
  --color-accent-strong: #185b46;
  --color-accent-subtle: rgba(29, 110, 84, 0.07);
  --color-line: rgba(26, 33, 40, 0.08);
  --color-panel: rgba(255, 255, 255, 0.78);
  --color-pane-82: rgba(245, 247, 249, 0.82);

  --radius-card: 10px;
  --radius-panel: 12px;
  --font-mono: "JetBrains Mono", ui-monospace, "SFMono-Regular", "Menlo", monospace;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 15px;
  --leading-relaxed: 1.65;
}
```

这段 `@theme` 是 docs 专用编译期映射，不是对外 CSS 契约。原因是 demo 仍在使用 `text-ink`、`text-muted-strong`、`bg-accent-subtle`、`border-line`、`rounded-card`、`p-dialog-code-padding`、`h-scroll-area-demo-height` 等 Tailwind utility；一旦 `style.css` 从 `@theme` 改为纯 `:root`，Tailwind 不会自动生成这些工具类。

如果不想维护 docs 专用 `@theme`，替代方案是把 demo / Playground 中的语义色工具类全部迁移为普通 CSS class 或 inline style。但第一阶段推荐保留 docs `@theme`，改动面更小。

文档站规则：

- demo 和 Playground 可以继续使用 Tailwind 做文档布局，但这是 docs 内部实现，不进入发布 CSS 契约。
- demo 和 Playground 继续使用的语义色、spacing、radius、font utility 必须在 docs 专用 `@theme` 中注册。
- 组件源码里的生产样式不得再依赖 Tailwind utility class。
- `.dumirc.ts` / dumi global CSS 改为导入 docs 专用 Tailwind 入口。
- `docs:build` 是迁移验收项，不能只验证组件包构建。
- docs 暗色模式不作为第一阶段验收目标；如果保留暗色切换，需要额外验证 `prefersColor.switch` 下的变量覆盖。

## Web 迁移约束

`packages/web/src/styles.css` 不能只是简单替换 import 路径，还要处理 Tailwind token 注册和运行时变量覆盖顺序。

### spacing scale

当前 Web 通过导入 `../../ui/src/tokens.css` 的 `@theme` 获得 `--spacing-1` 到 `--spacing-13`，从而生成 `p-1`、`gap-2` 等 Tailwind 工具类。`tokens.css` 改成纯 `:root` 后，这些 spacing token 不再注册进 Web 的 Tailwind 主题。

迁移时必须二选一：

1. Web 自己在 `packages/web/src/styles.css` 的 `@theme` 中注册 spacing scale，继续生成现有 Tailwind 工具类。
2. Web 页面逐步迁移到自己的 Web token，不再依赖 UI 包的 spacing scale。

第一阶段推荐选择 1，避免业务页面布局回归。UI 包的 `tokens.css` 只负责运行时变量，Web 的 `@theme` 只负责 Web 自己的 Tailwind 编译期工具类，二者职责分离。

### 语义变量覆盖顺序

预构建 `@clawbot/ui/style.css` 会提供默认 `:root`，Web 也会提供自己的 `:root` / `@theme`。两者 selector 优先级相同，后声明者生效。为了保证 Web 换肤覆盖 UI 默认值，推荐顺序：

```css
@import "tailwindcss";
@import "@clawbot/ui/style.css";

@theme {
  /* Web 自己需要生成 utility 的编译期 token，例如 spacing scale */
}

:root {
  /* Web runtime theme override，必须在 @clawbot/ui/style.css 之后 */
  --color-accent: #156e63;
  --color-accent-strong: #0f5b52;
  --color-paper: #f4f7f8;
}
```

如果 Web 继续用 Tailwind `@theme` 定义语义颜色，必须确认最终生成 CSS 位于 `@clawbot/ui/style.css` 之后；否则 `@clawbot/ui` 默认主题会覆盖 Web 主题。更稳的是把 Web 运行时换肤变量放在普通 `:root` 中，并位于 UI import 之后。

## tailwind-merge 的角色

组件内部改为 `cb-*` class 后，`tailwind-merge` 不再能理解或去重组件变体 class。

迁移期可以保留 `cn()`：

- 用于兼容消费方传入 Tailwind class。
- 用于继续合并条件 class。
- 配合 `@layer clawbot`，让外部 class 覆盖行为更可预测。

长期可以评估把 `cn()` 降级为 `clsx`，但这是独立依赖治理，不是本次迁移的必要条件。

## 消费方用法

默认使用：

```tsx
import { Button } from "@clawbot/ui";
import "@clawbot/ui/style.css";
```

换肤：

```css
@import "@clawbot/ui/style.css";

:root {
  --color-accent: #156e63;
  --color-accent-strong: #0f5b52;
  --color-paper: #f4f7f8;
}
```

`packages/web/src/styles.css` 应从相对源码路径改为包名入口：

```css
@import "@clawbot/ui/style.css";
```

## 迁移步骤

### Phase 1：建立发布边界

1. 将 `tokens.css` 改为纯 `:root` CSS 变量。
2. 将 `style.css` 改为默认主题入口，去掉 `@import "tailwindcss"`、`@theme` 和 `@source`。
3. 增加真实 CSS bundler，确保 `dist/style.css` 内联全部组件 CSS，不含悬空相对 import。
4. 在 `package.json` 中补齐 `./style.css`、`./tokens.css`、`./sonner.css` exports 和 CSS `sideEffects`。
5. 明确 `index.mjs` 的 CSS side effect import 指向 `dist/style.css`。

### Phase 2：先做复杂组件 pilot

不要只用 `Button` 验证方案。`Button` 太简单，无法覆盖 Base UI data attribute、响应式状态、多 part 组合和浮层交互。

先选择 `Dialog` 或 `Select` 做 pilot：

- `Dialog` 覆盖 overlay、portal、data-state、响应式布局、split/sidebar/footer 多 part。
- `Select` 覆盖 popup、item state、trigger size、keyboard/focus state。

pilot 通过后，再迁移其他组件：

1. `Dialog` 或 `Select` pilot
2. `Button`
3. `Badge`
4. `Input`
5. `Card`
6. `Toggle` / `ToggleGroup`
7. 剩余的 `Dialog` / `Select`
8. `Accordion`
9. `ScrollArea`
10. `AdminCard`
11. `Slider`
12. `Sonner`

迁移时保持公开 props 和已导出的 className helper 不变，只替换 helper 返回的 class 实现。确实要删除 helper 时，必须按 breaking change 处理。

### Phase 3：隔离 docs Tailwind

1. 新增 docs 专用 Tailwind 入口，例如 `packages/ui/.dumi/docs-tailwind.css`。
2. dumi global CSS 改为导入 docs 专用入口。
3. 在 docs 专用 `@theme` 中注册 demo 仍使用的 spacing、语义色、radius、font、text、leading token。
4. demo 和 Playground 的 Tailwind layout / color class 留在 docs 编译链中。
5. 对外 `packages/ui/src/style.css` 不再承担 Tailwind 编译入口职责。

### Phase 4：同步 skill 和组件文档

当前 `.agent/skills/ui-design/SKILL.md` 仍以 Tailwind `@theme` 为事实源。完成迁移后需要同步改为：

- 组件必须使用 `style.css` / `tokens.css` 中的 CSS 变量。
- 禁止新增 Tailwind utility class 作为组件库内部生产样式。
- 禁止组件内 magic number，新增值必须先沉淀为 CSS 变量。
- token 违规扫描从 Tailwind 任意值扫描调整为 CSS 变量和裸色值扫描。

组件 `index.md` 和 Playground 不需要因为样式实现改变而改 API 表，但如果文档中提到 Tailwind token 或源码路径，需要同步删除。

### Phase 5：切换 Web 消费方

1. `packages/web/src/styles.css` 改为导入 `@clawbot/ui/style.css`。
2. 删除对 `../../ui/src/tokens.css` 等源码路径的依赖。
3. Web 自己在 `@theme` 中保留需要生成 utility 的 spacing scale。
4. Web 的运行时语义变量放在 `@clawbot/ui/style.css` 之后，保证覆盖 UI 默认主题。
5. Web 自己只覆盖语义 token，不重复声明组件 token。
6. 跑 Web 类型检查和构建，确认 Vite 不再依赖 UI 源码 CSS。

## 验收标准

- `packages/ui/src/tokens.css` 中没有 `@import "tailwindcss"`。
- `packages/ui/src/tokens.css` 和 `packages/ui/src/style.css` 中没有 `@theme`。
- `packages/ui/src/style.css` 不再包含 `@source`。
- 旧 `@theme` 中所有自定义 token 都已迁移到 `style.css` 或 `tokens.css` 的 `:root`。
- `dist/style.css` 不含指向源码组件目录的相对 `@import`。
- `dist/index.mjs` 的 CSS side effect import 能解析到 `dist/style.css`。
- `packages/ui` 组件生产样式不再依赖 `bg-button-*`、`h-button-*`、`text-ink` 等 Tailwind token class。
- dumi 文档站仍能构建，demo / Playground 布局和配色不丢失。
- `packages/web/src/styles.css` 不再通过相对路径导入 UI 源码 CSS。
- Web 仍能生成现有页面依赖的 spacing utility。
- 消费方覆盖 `--color-accent` 后，Button、Toggle、Badge 等组件跟随变色。

## 校验命令

迁移完成后至少执行：

```bash
pnpm -F @clawbot/ui typecheck
pnpm -F @clawbot/ui fmt:check
pnpm -F @clawbot/ui lint
pnpm -F @clawbot/ui build
pnpm -F @clawbot/ui docs:build
pnpm -F @clawbot/web typecheck
```

建议增加扫描：

```bash
# UI 对外样式入口不应再依赖 Tailwind @theme / @source
rg -n '@theme|@source|@import "tailwindcss"' packages/ui/src/style.css packages/ui/src/tokens.css

# dist/style.css 不应保留悬空相对 import
rg -n '@import "\\./' packages/ui/dist/style.css

# 旧 @theme token 必须全部落到运行时变量声明；执行时人工比对输出
rg -n '^\s*--(color|spacing|radius|shadow|font|text|leading|tracking|ease)-' packages/ui/src/style.css packages/ui/src/tokens.css

# docs 专用 Tailwind 入口必须保留 demo 所需的编译期 token 注册
rg -n '@theme|--color-(ink|muted|muted-strong|accent|accent-strong|accent-subtle|line|panel|pane-82)|--spacing-[0-9]+' packages/ui/.dumi

# UI 组件 CSS 不应出现裸色值；tokens/style.css/sonner.css 允许集中声明
rg -n '#[0-9a-fA-F]{3,8}|rgba?\(' packages/ui/src --glob '*.css' --glob '!style.css' --glob '!tokens.css' --glob '!sonner.css' --glob '!**/demos/**'
```

第三条扫描不是绝对禁止命中，但组件 CSS 中的裸颜色命中必须人工确认并迁移到 token。
