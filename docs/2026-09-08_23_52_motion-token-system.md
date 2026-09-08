# Motion Token 体系与动效规范

> 状态：设计定稿，待实施。分支：`feat/ui-motion-system`。
>
> 范围：`packages/ui` 动效 token 体系、全库动效迁移、`prefers-reduced-motion` 全局降级、文档站动效规范页与交互式缓动编辑器。

## 1. 背景与问题

组件库的视觉体系（颜色、字号、圆角、阴影、间距）已全部 token 化，且有三层归置规则（`style.css` 基础/语义层、`tokens.css` 共享层、组件级 `style.css`）。但动效没有：

- 全库只有 **1 个**动效 token：`--ease-expo`（`src/style.css:144`）。
- 时长是散落的 magic number：`75ms / 0.1s / 0.15s / 0.2s / 0.3s / 160ms` 共 6 种取值，分布在 13 个文件、约 26 处 `transition` 声明里。
- 缓动只有一个 `--ease-expo`（减速曲线），**退场也用它**——加速退场的节奏感缺失。
- `prefers-reduced-motion` 只有 `Playground.css`（文档站工具）用 `!important` 局部处理，组件本身没有降级路径。
- 交互控件的物理感（Switch/Slider 的 thumb）与状态色的过渡使用同一条曲线，动效没有语义分层。

结论：动效目前是"临场手调"，与库的 token 纪律矛盾。本方案把动效提升为与颜色同级的 token 体系。

## 2. 设计原则

1. **动效是 token，不是手调值**：时长、缓动一律走 CSS 自定义属性，组件 CSS 中禁止出现字面量 duration。
2. **语义命名，不命名视觉实现**：`entrance / exit / spring` 表达"用在哪"，不表达曲线形状。
3. **少而准**：4 档时长、4 条缓动曲线封顶。出现第 5 档需求时先回到场景判断，不扩表。
4. **可全局降级**：所有动效引用 token 后，`prefers-reduced-motion` 的处理收敛为对 token 的媒体查询覆盖，不需要 `!important` 扫射。
5. **归置遵循既有规则**：动效 token 属于基础/语义层 → `src/style.css`；不新增平行文件（keyframes 目前无需求，按需再引入）。

## 3. Token 设计

### 3.1 时长档位（新增到 `src/style.css`）

| Token | 值 | 语义场景 | 吸收的现状值 |
| --- | --- | --- | --- |
| `--duration-instant` | `80ms` | 按压/active 即时反馈、菜单项高亮 | `75ms`、`0.1s` |
| `--duration-fast` | `140ms` | hover、颜色/边框/阴影等低位移状态变化 | `0.15s`、部分 `0.2s` |
| `--duration-base` | `200ms` | 标准位移：图标旋转、thumb 移动、chevron、小浮层进出场 | `0.2s` 主体、`160ms` |
| `--duration-slow` | `320ms` | 大面积浮层（Dialog）、focus ring 呼吸、Accordion 展开 | `0.3s` |

命名与取值理由：

- 档位差保持约 1.4 倍几何递进（80 → 140 → 200 → 320），符合 Weber-Fechner 感知规律，混用时不易"差不多"。
- 后台管理台是高频扫描场景，整体密度偏紧，封顶 320ms；不设 `slow` 以上档位。

### 3.2 缓动曲线（语义化，替换 `--ease-expo`）

| Token | 值 | 语义 | 用于 |
| --- | --- | --- | --- |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 中性对称 | 颜色/边框/阴影等无方向属性 |
| `--ease-entrance` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | 减速入场（= 现 `--ease-expo`） | 浮层入场、展开、图标旋入 |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | 加速退场 | 浮层退场、收起 |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | 轻微过冲（回弹系数 1.4，克制） | Switch/Slider/ToggleGroup 的 thumb 物理感 |

- `--ease-expo` **删除**，不保留别名。迁移后 grep 确认 `var(--ease-expo)` 归零。
- 过冲系数取 1.4 而非经典的 1.56：管理台场景的物理感要"稳中带一点俏皮"，不能玩具化。

### 3.3 `prefers-reduced-motion` 全局降级

迁移完成后，在 `src/style.css` 的 token 定义之后追加：

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-instant: 1ms;
    --duration-fast: 1ms;
    --duration-base: 1ms;
    --duration-slow: 1ms;
  }
}
```

由于所有 `transition`/`animation` 的时长都引用 `var(--duration-*)`，这一块即可让全库动效退化为瞬时切换。`Playground.css` 现有的 `transition-duration: 0.01ms !important` 扫射块随之删除。

关键前置条件：**组件 CSS 里的时长必须全部 token 化**，否则字面量时长不受媒体查询影响——这也是本次迁移的验收标准之一。

### 3.4 明确不做

- **不新增 keyframes 库**：现有浮层进出场全部由 Base UI 的 `data-starting-style` / `data-ending-style` + transition 驱动（Dialog 已是范例），没有需要 keyframes 的场景。出现循环动画（如骨架屏）需求时再按需引入 `motion.css`。
- **不做 JS 驱动的 spring**（motion/framer 等依赖）：CSS 曲线足够，库保持零动效依赖。
- **不做暗色主题**：另行立项（`color-scheme` 写死 light 是独立问题）。

## 4. 迁移清单（逐文件）

现状盘点 → 目标映射。规则：**时长与缓动成对出现**，写 `var(--duration-x) var(--ease-y)`。

| 文件:行 | 现状 | 目标 |
| --- | --- | --- |
| `shared.css:17`（button/toggle 基类） | bg/border/color `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Breadcrumb/style.css:28` | 多属性 `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Breadcrumb/style.css:72` | color `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Slider/style.css:41`（track 填充） | all `75ms expo` | `--duration-instant` + `--ease-standard`（去掉 `all`，显式列属性） |
| `Slider/style.css:53`（thumb） | transform `0.2s expo` | `--duration-base` + `--ease-spring` |
| `Accordion/style.css:20`（trigger bg） | bg `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Accordion/style.css:48`（chevron 旋转） | transform `0.2s expo` | `--duration-base` + `--ease-entrance` |
| `Input/style.css:16`（focus border/shadow） | `0.3s expo` | `--duration-slow` + `--ease-standard` |
| `Pagination/style.css:44` | 多属性 `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Select/style.css:30`（trigger focus） | bg/border/shadow `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Select/style.css:96`（下拉箭头旋转） | transform `0.2s expo` | `--duration-base` + `--ease-entrance` |
| `Select/style.css:168`（item 高亮） | bg `0.1s expo` | `--duration-instant` + `--ease-standard` |
| `Select/style.css`（popup，若缺进出场） | — | 补 `opacity + scale(0.97→1)`：入 `--duration-fast` + `--ease-entrance`，出 `--duration-instant` + `--ease-exit`；`transform-origin: var(--transform-origin)`（Base UI 提供） |
| `Dialog/style.css:43`（content 进出场） | opacity/transform `0.2s expo` | 入 `--duration-slow` + `--ease-entrance`；`[data-ending-style]` 覆盖为 `--duration-fast` + `--ease-exit` |
| `Dialog/style.css:79`（close 按钮） | bg/border/color `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Dialog/style.css`（overlay 淡入淡出） | 现无 | 补 opacity 过渡：入 `--duration-slow`，出 `--duration-fast` |
| `Tooltip/style.css:37` | opacity/transform `0.15s expo` | `--duration-fast` + `--ease-entrance`（出场 `--ease-exit`） |
| `AdminCard/style.css:31` | 多属性 `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `AdminCard/style.css:47` | opacity `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `AdminCard/style.css:112` | bg/color `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Switch/style.css:13`（track 颜色） | bg/border/shadow `0.2s expo` | `--duration-fast` + `--ease-standard` |
| `Switch/style.css:65`（thumb 位移） | transform `0.2s expo` | `--duration-base` + `--ease-spring` |
| `Playground/Playground.css:191/232/303/320` | `160ms ease` 等 | `--duration-base` + `--ease-standard`（文档站工具一并收敛） |
| `Playground/Playground.css:353-355` | reduced-motion `!important` 扫射 | 删除（token 覆盖已全局生效） |
| `style.css:144` | `--ease-expo` | 删除，替换为 3.2 的语义曲线组 |

## 5. 文档站方案（作品集呈现）

文档站已有自定义 dumi 主题（首页组件目录、Header/Sidebar/Previewer 均已定制），本轮在此基础上新增"动效"板块。

### 5.1 动效规范页 `docs/motion.md`

新增 `packages/ui/docs/motion.md`，进入侧边栏"设计规范"分组，内容：

1. 动效原则（3.1–3.3 的浓缩版，面向使用者）。
2. 时长档位表 + 每档的实时演示（hover 我一次就能感到 80/140/200/320 的差异）。
3. 缓动曲线语义表，每条曲线配"入场/退场"对照演示。
4. 组件动效对照表（哪个组件用哪组 token，与第 4 节迁移表同步维护）。
5. `prefers-reduced-motion` 声明与演示开关。

### 5.2 交互式缓动编辑器（signature piece）

`EasingPlayground`，纯 React + SVG 实现，零新依赖，放在 `docs/motion.md` 内：

- **贝塞尔曲线画布**：两个控制点可拖拽，实时渲染曲线与时间比值网格。
- **运动预览**：小球/方块沿当前曲线做进出场对比（可切 4 档时长）。
- **库内 preset 对照**：一键切换 `--ease-standard / entrance / exit / spring`，并排对比。
- **输出**：实时生成 `cubic-bezier(...)` + 完整 `transition` 声明，一键复制。
- **reduced-motion 模拟**：开关打开后预览退化为瞬时切换，直观展示降级效果。
- 实现位置：`.dumi/theme/builtins/EasingPlayground/`（文档站工具，样式内联/局部 CSS，不进组件库导出）。

### 5.3 首页强化

- hero 区新增"设计系统"入口卡组：Design Tokens / Motion / Icons 三卡，Motion 卡内嵌一个 token 驱动的循环微动效（呼吸的 accent 圆点）。
- 组件目录（已有）保持不动。

## 6. 校验与验收标准

除 SKILL.md 既有校验（`typecheck / fmt:check / lint / build / docs:build` + 两条 token 违规扫描）外，新增第三条动效违规扫描，命中应为空：

```bash
# 3. 字面量时长：transition/animation 的 duration 必须引用 var(--duration-*)
rg -n 'transition(-property|-duration)?\s*:|animation(-duration)?\s*:' packages/ui/src --glob '*.css' \
  | rg -v 'var\(--duration-' | rg '[0-9.]+m?s'
```

（该扫描会由本次提交实际校准，确保不误伤；与现有两条扫描一起写入 SKILL.md 校验流程。）

验收标准：

1. `rg -n 'var\(--ease-expo\)' packages/ui/src` 归零。
2. 动效扫描（上条）归零。
3. `@media (prefers-reduced-motion: reduce)` 下，Dialog/Tooltip/Select 进出场无可见动画（文档站 DevTools 模拟验证）。
4. `docs:build` 通过，`docs/motion.md` 与 EasingPlayground 正常渲染、可交互。
5. 迁移不改变任何组件的 DOM 结构与 API（纯 CSS 变更 + 文档站新增）。

## 7. 实施步骤

1. **Phase 1 — motion token 体系**：`style.css` 新增时长/缓动 token + reduced-motion 覆盖块 → 按第 4 节逐文件迁移 → 补 Select popup / Dialog overlay 缺失的进出场 → Playground.css 收敛 → 全量校验 → commit。
2. **Phase 2 — 文档站**：`docs/motion.md` + EasingPlayground + 首页入口卡 → `docs:build` 验证 → commit。
3. **Phase 3 — 后续立项（不在本分支）**：暗色主题、Playwright 视觉回归、签名数据可视化组件。

同步动作：SKILL.md 的「Tailwind Token 使用规则」补充动效 token 归置说明与第三条扫描命令，保持规范与实现一致。
