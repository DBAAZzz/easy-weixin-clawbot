# Motion Token 体系与动效规范

> 状态：设计定稿，待实施。分支：`feat/ui-motion-system`。
> 修订：2026-09-09 新增「生态对标与选型」一节，时长/缓动数值经 Carbon、Material 3 校准。
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
6. **CSS 优先，不重复造引擎**：本库全部动效场景用 CSS transition 覆盖；JS 动画引擎属于业务层选型，不进组件库依赖（见第 3.2 节）。

## 3. 生态对标与选型

自己实现的只有约 40 行 CSS 变量；动效语言对标成熟设计系统，动效引擎按需采用业界标准库。分层如下。

### 3.1 动效语言：对标 Carbon 与 Material 3

| 我方 token | 值 | Carbon 对标 | Material 3 对标 |
| --- | --- | --- | --- |
| `--duration-instant` 80ms | 按压/高亮 | `duration-fast-01` 70ms（按钮微交互） | short 档 50–100ms |
| `--duration-fast` 140ms | hover/颜色 | `duration-fast-02` 110ms（fade）～ `moderate-01` 150ms | short 150ms |
| `--duration-base` 200ms | 位移/小浮层 | `moderate-01` 150ms ～ `moderate-02` 240ms | short4 200ms |
| `--duration-slow` 320ms | 大浮层/focus | `moderate-02` 240ms ～ `slow-01` 400ms | medium 250–300ms |
| `--ease-standard` `cubic-bezier(0.2, 0, 0, 1)` | 中性对称 | standard-productive `cubic-bezier(0.2, 0, 0.38, 0.9)` | **emphasized `cubic-bezier(0.2, 0, 0, 1)`，数值完全一致** |
| `--ease-entrance` `cubic-bezier(0.22, 0.61, 0.36, 1)` | 减速入场 | entrance-productive `cubic-bezier(0, 0, 0.38, 0.9)` | emphasized-decelerate `cubic-bezier(0.05, 0.7, 0.1, 1)` |
| `--ease-exit` `cubic-bezier(0.4, 0, 1, 1)` | 加速退场 | exit-productive `cubic-bezier(0.2, 0, 1, 0.9)` | emphasized-accelerate `cubic-bezier(0.3, 0, 0.8, 0.15)` |
| `--ease-spring` `cubic-bezier(0.34, 1.4, 0.64, 1)` | 微量过冲 | —（expressive 系列承担此角色） | M3 Expressive 的物理 spring |

采纳与校准结论：

- **语义命名被验证**：Carbon 的 `standard / entrance / exit` 三分类与本方案命名一一对应；时长档位落在 Carbon 与 M3 档位之间，1.4 倍几何递进成立。数值在文档站实机演示后允许 ±20ms 微调，档位结构不变。
- **采纳 Carbon 的使用规则**：退场后仍停留在视口附近的元素（侧面板、折叠区）用 `standard` 而非 `exit`——`exit` 只给"永久消失"的元素。
- **productive/expressive 二分**：Carbon 以 productive（快、少修饰）为主、expressive（慢、有性格）点缀，对应本库"管理台以 standard/entrance/exit 为主，spring 只给物理控件微量表达"的定位。
- **spring 的诚实边界**：CSS `cubic-bezier` 过冲只是物理弹簧的近似（无速度连续性）；真 spring 留给业务层的 Motion（见 3.2）。文档站如实标注这一点。

### 3.2 动效引擎：分层选型

| 场景 | 工具 | 归属 |
| --- | --- | --- |
| hover、颜色/阴影、thumb 位移、浮层进出场 | CSS transition + 本方案 token | 组件库（0 依赖） |
| 布局 FLIP、手势、列表编排、图表数据插值 | [Motion](https://motion.dev/docs/react-reduce-bundle-size)（`motion/react`，原 framer-motion；官方 `m` 组件 + `LazyMotion` 可大幅瘦身） | 业务层 opt-in，**不进 `@clawbot/ui` 依赖树** |
| 文档站页面切换演示 | View Transitions API | 文档站（渐进增强，组件库不依赖） |
| 列表 insert/remove 微动画 | auto-animate 或 Motion | 业务层 opt-in |

不引入引擎进组件库的理由：

- Base UI 的进出场协调（`data-starting-style` / `data-ending-style` + 卸载时机）与 Motion 的 `AnimatePresence` 是两套卸载机制，同库并用必然打架。
- 本库全部现存场景（约 26 处 transition）CSS 已覆盖，引擎是纯增量成本。
- 不选 GSAP：命令式时间线范式与 React 声明式相性差，且形成第二套动效心智。不选 react-spring：维护节奏放缓。不用 `framer-motion` 旧包名：官方已改名 `motion`。

## 4. Token 设计

### 4.1 时长档位（新增到 `src/style.css`）

| Token | 值 | 语义场景 | 吸收的现状值 |
| --- | --- | --- | --- |
| `--duration-instant` | `80ms` | 按压/active 即时反馈、菜单项高亮 | `75ms`、`0.1s` |
| `--duration-fast` | `140ms` | hover、颜色/边框/阴影等低位移状态变化 | `0.15s`、部分 `0.2s` |
| `--duration-base` | `200ms` | 标准位移：图标旋转、thumb 移动、chevron、小浮层进出场 | `0.2s` 主体、`160ms` |
| `--duration-slow` | `320ms` | 大面积浮层（Dialog）、focus ring 呼吸、Accordion 展开 | `0.3s` |

命名与取值理由：

- 档位差保持约 1.4 倍几何递进（80 → 140 → 200 → 320），符合 Weber-Fechner 感知规律，混用时不易"差不多"；对标关系见 3.1。
- 后台管理台是高频扫描场景，整体密度偏紧，封顶 320ms；不设 `slow` 以上档位。

### 4.2 缓动曲线（语义化，替换 `--ease-expo`）

| Token | 值 | 语义 | 用于 |
| --- | --- | --- | --- |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 中性对称（= M3 emphasized） | 颜色/边框/阴影等无方向属性；退场后停留在附近的元素 |
| `--ease-entrance` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | 减速入场（= 现 `--ease-expo`） | 浮层入场、展开、图标旋入 |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | 加速退场 | 浮层退场、永久消失的元素 |
| `--ease-spring` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | 轻微过冲（回弹系数 1.4，克制） | Switch/Slider/ToggleGroup 的 thumb 物理感 |

- `--ease-expo` **删除**，不保留别名。迁移后 grep 确认 `var(--ease-expo)` 归零。
- 过冲系数取 1.4 而非经典的 1.56：管理台场景的物理感要"稳中带一点俏皮"，不能玩具化；真物理弹簧由业务层 Motion 承担（3.2）。

### 4.3 `prefers-reduced-motion` 全局降级

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

### 4.4 明确不做

- **不新增 keyframes 库**：现有浮层进出场全部由 Base UI 的 `data-starting-style` / `data-ending-style` + transition 驱动（Dialog 已是范例），没有需要 keyframes 的场景。出现循环动画（如骨架屏）需求时再按需引入 `motion.css`。
- **不做 JS 驱动的 spring 进组件库**：CSS 曲线覆盖组件库全部场景，库保持零动效依赖；业务层需要真物理 spring 时 opt-in Motion（3.2）。
- **不做暗色主题**：另行立项（`color-scheme` 写死 light 是独立问题）。

## 5. 迁移清单（逐文件）

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
| `style.css:144` | `--ease-expo` | 删除，替换为 4.2 的语义曲线组 |

## 6. 文档站方案（作品集呈现）

文档站已有自定义 dumi 主题（首页组件目录、Header/Sidebar/Previewer 均已定制），本轮在此基础上新增"动效"板块。

### 6.1 动效规范页 `docs/motion.md`

新增 `packages/ui/docs/motion.md`，进入侧边栏"设计规范"分组，内容：

1. 动效原则（4.1–4.3 的浓缩版，面向使用者）。
2. 时长档位表 + 每档的实时演示（hover 一次就能感到 80/140/200/320 的差异）。
3. 缓动曲线语义表，每条曲线配"入场/退场"对照演示。
4. 生态对标表（3.1）：token 与 Carbon / M3 的对应关系，注明"standard 即 M3 emphasized"。
5. 组件动效对照表（哪个组件用哪组 token，与第 5 节迁移表同步维护）。
6. `prefers-reduced-motion` 声明与演示开关。

### 6.2 交互式缓动编辑器（signature piece）

`EasingPlayground`，纯 React + SVG 实现，零新依赖，放在 `docs/motion.md` 内：

- **贝塞尔曲线画布**：两个控制点可拖拽，实时渲染曲线与时间比值网格。
- **运动预览**：小球/方块沿当前曲线做进出场对比（可切 4 档时长）。
- **库内 preset 对照**：一键切换 `--ease-standard / entrance / exit / spring`，并排对比。
- **输出**：实时生成 `cubic-bezier(...)` + 完整 `transition` 声明，一键复制。
- **reduced-motion 模拟**：开关打开后预览退化为瞬时切换，直观展示降级效果。
- 实现位置：`.dumi/theme/builtins/EasingPlayground/`（文档站工具，样式内联/局部 CSS，不进组件库导出）。

### 6.3 首页强化

- hero 区新增"设计系统"入口卡组：Design Tokens / Motion / Icons 三卡，Motion 卡内嵌一个 token 驱动的循环微动效（呼吸的 accent 圆点）。
- 组件目录（已有）保持不动。

## 7. 校验与验收标准

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

## 8. 实施步骤

1. **Phase 1 — motion token 体系**：`style.css` 新增时长/缓动 token + reduced-motion 覆盖块 → 按第 5 节逐文件迁移 → 补 Select popup / Dialog overlay 缺失的进出场 → Playground.css 收敛 → 全量校验 → commit。
2. **Phase 2 — 文档站**：`docs/motion.md`（含生态对标表）+ EasingPlayground + 首页入口卡 → `docs:build` 验证 → commit。
3. **Phase 3 — 后续立项（不在本分支）**：暗色主题、Playwright 视觉回归、签名数据可视化组件；业务层复杂编排（图表数据插值、列表 FLIP）届时 opt-in Motion。

同步动作：SKILL.md 的「Tailwind Token 使用规则」补充动效 token 归置说明与第三条扫描命令，保持规范与实现一致。
