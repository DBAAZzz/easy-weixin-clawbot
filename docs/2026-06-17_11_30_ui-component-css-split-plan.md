# UI 组件样式拆分方案

## 背景

`packages/ui/src/components.css` 目前承载了多个组件的完整样式。随着组件数量增加，这个文件会持续膨胀，带来几个问题：

- 组件实现、类型、文档和样式分散在不同位置，维护时需要跨文件跳转。
- 新增或修改组件容易集中冲突在同一个 CSS 文件。
- 删除组件时样式不容易同步清理。
- review diff 不够聚焦，难以快速判断改动是否只影响目标组件。

因此，后续应逐步把组件私有样式移动到各自组件目录中，让 `components.css` 只承担共享基础样式或最终被更明确的共享样式文件替代。

## 目标结构

每个组件目录维护自己的样式文件：

```txt
packages/ui/src/Pagination/
  Pagination.tsx
  type.ts
  style.ts
  style.css
  index.ts
  index.md
  demos/
    playground.tsx
```

组件入口负责导入本组件样式：

```ts
import "./style.css";

export * from "./Pagination.js";
```

根入口继续统一导出组件：

```ts
import "./style.css";

export * from "./Pagination/index.js";
```

其中根级 `packages/ui/src/style.css` 仍然作为公共样式入口，负责引入 token 和共享样式。

## 文件职责

### `tokens.css`

只放设计 token 和组件级 token，例如：

```css
:root {
  --spacing-pagination-gap: var(--spacing-4);
  --spacing-pagination-item: var(--spacing-11);
  --color-pagination-bg: var(--color-surface-raised, #ffffff);
}
```

组件私有选择器不放在 `tokens.css`。

### 根级 `style.css`

作为公共样式入口，保持消费者导入路径稳定：

```css
@import "./tokens.css";
@import "./shared.css";
```

如果打包流程确认组件目录 CSS 会被 JS 入口收集，可以不在根级 `style.css` 显式导入每个组件 CSS。否则需要由根级入口集中导入组件 CSS，保证 `@clawbot/ui/style.css` 包含完整组件样式。

### `shared.css`

从当前 `components.css` 中抽出真正跨组件共享的基础规则，例如：

- 通用 focus ring。
- 通用 disabled 行为。
- 图标尺寸约束。
- 多组件共用的动作状态基础类。

不要把某个组件的完整视觉规则放到 `shared.css`。

### 组件目录 `style.css`

只放该组件自己的 class，例如：

```css
@layer clawbot {
  .cb-pagination {
    display: inline-flex;
    align-items: center;
  }

  .cb-pagination-button {
    border: 1px solid var(--color-pagination-border);
    background: var(--color-pagination-bg);
  }
}
```

组件 CSS 可以使用 `tokens.css` 中的 token，但不要定义一次性 magic value，也不要使用 Tailwind 默认调色板或任意值。

### 组件目录 `style.ts`

继续只负责 className 组合和语义变体映射：

```ts
export function paginationClassName(options?: PaginationClassNameOptions) {
  return cn("cb-pagination", options?.className);
}
```

不要在 `style.ts` 里承载大量视觉实现细节。

## 打包注意事项

当前 `@clawbot/ui` 的公共 CSS 导出是：

```json
{
  "./style.css": "./dist/style.css"
}
```

迁移前必须确认以下行为：

1. 组件目录中的 `import "./style.css"` 会被 `tsdown` 收集。
2. `scripts/bundle-css.mjs` 会把组件 CSS 合并进 `dist/style.css`。
3. 消费方只导入 `@clawbot/ui/style.css` 时，仍能拿到全部组件样式。
4. dumi 文档构建时组件样式不会丢失。

如果第 2 点不成立，需要调整 `scripts/bundle-css.mjs`，让它扫描并合并：

```txt
packages/ui/src/**/style.css
```

合并顺序建议为：

1. `tokens.css`
2. `shared.css`
3. 各组件目录的 `style.css`
4. 特殊第三方样式，例如 `sonner.css`

## 渐进迁移步骤

### 阶段一：新增组件采用新结构

新增组件默认在组件目录下创建 `style.css`，不再继续向 `components.css` 追加完整样式。

适用对象：

- 新组件。
- 正在大幅调整视觉结构的组件。

### 阶段二：拆出低风险组件

优先迁移样式边界清晰、依赖少的组件：

1. `Pagination`
2. `Badge`
3. `Switch`
4. `Slider`
5. `ScrollArea`

每次迁移一个组件，迁移后执行完整校验。

### 阶段三：拆出组合组件

再迁移样式更多、组合结构更复杂的组件：

1. `Button`
2. `Toggle`
3. `ToggleGroup`
4. `Input`
5. `Select`
6. `Dialog`
7. `AdminCard`

这些组件可能共享 focus、disabled、icon 等规则。迁移时先抽 `shared.css`，再移动组件私有规则。

### 阶段四：收敛 `components.css`

当组件私有样式迁移完成后：

- 将 `components.css` 改名为 `shared.css`，或删除后新建 `shared.css`。
- 根级 `style.css` 改为导入 `tokens.css` 和 `shared.css`。
- 确认没有组件私有选择器残留在共享文件中。

## 单组件迁移检查清单

迁移一个组件时按以下顺序执行：

1. 在组件目录新增 `style.css`。
2. 将该组件相关 `.cb-*` 规则从 `components.css` 移入组件 `style.css`。
3. 在组件 `index.ts` 中导入 `./style.css`。
4. 保留或抽出真正共享的 focus、disabled、icon 规则。
5. 确认 `tokens.css` 中组件 token 仍保留在全局 token 文件。
6. 执行格式化、类型检查、lint、构建和文档构建。
7. 执行 token 违规扫描。

校验命令：

```bash
pnpm -F @clawbot/ui typecheck
pnpm -F @clawbot/ui fmt:check
pnpm -F @clawbot/ui lint
pnpm -F @clawbot/ui build
pnpm -F @clawbot/ui docs:build
rg -n '(^|\s)(bg|text|border|rounded|shadow|ring|p|px|py|m|mx|my|w|h|min-w|max-w|min-h|max-h|gap|space)-\[' packages/ui/src --glob '!*.md'
rg -n '\b(bg|text|border|ring|from|to|via|fill|stroke|outline|divide|decoration)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}\b' packages/ui/src --glob '!*.md'
```

## 建议结论

建议采用渐进迁移，不一次性重排全部组件样式。短期从新增组件和 `Pagination` 开始使用组件目录 `style.css`；中期把低风险组件迁出；最后把 `components.css` 收敛为 `shared.css`。

这个方案可以减少集中冲突，提升组件维护性，同时保持 `@clawbot/ui/style.css` 的公共导入契约不变。
