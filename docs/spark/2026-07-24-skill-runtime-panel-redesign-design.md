# Skill 弹窗「环境配置」面板视觉重构（2026-07-24）

> 阅读对象：负责实施的 AI 编程智能体。本文是 spark 需求访谈后达成的共识，指导 `packages/web/src/features/Skills/` 的「环境配置」（runtime）tab 视觉重构。
>
> **范围严格限定在「环境配置」tab 的内容区**。不动弹窗外壳（`DialogFrame` / `contentClassName`）、不动「文档」tab、不动 meta 条与 tab 切换栏、不动后端与 API。上一轮已完成的环境检测/SSE 功能（见 `docs/2026-07-24_10_55_skill-modal-env-check-design.md`）保持不变，本文只改**呈现**。

---

## 0. 问题与目标

用户反馈两点：

1. **环境依赖列表不对齐、横线太多、视觉不清晰**。当前 `EnvironmentChecklist` 每行 `flex justify-between` + `border-t`，状态文案宽度不一（已满足/版本不符/无法检测）导致右对齐参差，逐行横线制造噪音。
2. **点「重新检测」时整个弹窗高度抖动**。`useSkillsPage.handlePreflight` 在请求前 `setPreflightPlan(null)`，面板掉回 3 行骨架（`preflightBusy && !preflight` 分支），比真实列表矮很多 → 弹窗塌陷，数据回来后再撑开。

目标：让「环境配置」内容更清晰、去横线、消除重新检测抖动，圆角保持克制。

---

## 1. 依赖清单：色点导轨 + 纯间距（去横线）

`EnvironmentChecklist.tsx` 的行结构从「`flex justify-between` + `border-t`」改为**三列网格 + 左侧色点导轨**。

### 1.1 行网格

每行用 `grid grid-cols-[auto_1fr_auto] items-center gap-x-2.5`，三列：

1. **色点**（`size-1.5 rounded-full`）—— 放在最左，所有行的色点垂直对齐成一条导轨，这条导轨替代原来的逐行横线承担「行间分隔」职能。
2. **包名 + 版本副行** —— 包名 `font-mono text-xs font-semibold text-ink`；版本/约束信息作为其下方小字副行（`text-2xs`/`text-xs text-muted`，具体见 §1.3）。
3. **状态短词** —— `text-xs font-semibold`，**定宽右对齐**（如 `min-w-[3.5rem] text-right`），保证「已满足 / 未安装 / 版本不符 / 无法检测」四种文案右边缘齐平。

### 1.2 行间距代替横线

- **删除所有 `border-t border-line`**。
- 行与行之间用 `row-gap`（如容器 `grid gap-y-2.5` 或每行 `py-*`）拉开，靠间距分组。
- 运行时行（Python/Node）与依赖行共用同一个行组件，运行时就是清单第一行，不再需要 `first` 特判去掉横线。

### 1.3 版本副行文案（沿用现有 `describeDependency` 语义）

| 状态 | 副行内容 |
|---|---|
| `ok` 有版本 | 版本号，如 `1.26.4` |
| `ok` 无版本 | 无副行 |
| `outdated` | `已装 {installedVersion} · 需要 {installSpec}` |
| `missing` | 无副行 |
| `unknown` | `未能读取环境信息` |
| 运行时行 | `{version} · .venv 已就绪 / 待创建`（node 用 `node_modules`） |

状态色沿用 `formatDependencyStatus`（不改）：ok=`account-success`、outdated=`account-warning`、missing=`danger`、unknown=`account-muted-faint`。运行时行状态映射为 `ok`（`status==="ok"`）或 `missing`。

### 1.4 头部状态汇总（新增）

清单上方一行头部：左侧 `text-xs tracking-label text-muted` 的「环境检测」标签，右侧一句状态汇总短语：

- 检测中：`● 检测中`（见 §3）
- 有待处理项：`{n} 项待处理`（`n` = 非 ok 的依赖数，含 outdated/missing/unknown；runtime missing 也计入）
- 全部就绪：`全部就绪`

汇总短语颜色跟随语义（待处理用 warning 色、就绪用 success 色、检测中用 accent 色）。

---

## 2. 安装命令 / 安装日志：同槽位、边框区分

命令与日志是同一件事的两个时态（「将要执行」→「正在执行」），占用**同一块位置**，按状态切换，但视觉形态刻意区分。

### 2.1 安装前 —— 安装命令（无框裸文本）

当没有日志时（`logs.length === 0` 且非安装中），该槽位显示命令预览：

- 标签：`安装命令 · {installer}`（`text-xs tracking-label text-muted`，`installer` 经 `formatInstallerLabel`）
- 命令：**裸等宽文本，无边框、无底色**。逐行 `font-mono text-xs text-muted`，靠 `mt-*` 间距与标签分开。
- 读感是「说明」，不是「区域」。
- `commandPreview` 为空则整块不渲染。

### 2.2 安装中 / 安装后 —— 安装日志（有框定高）

一旦开始安装（`busy` 或 `logs.length > 0`），同一槽位换成 `ProvisionConsole`：

- 标签：`安装日志` + 右侧状态标签（安装中带脉冲点 / 已完成 / 失败），沿用现有 `ProvisionConsole` 逻辑。
- 日志区：**有边框**（`border border-line` + `bg-white/78`）+ **固定高度**（见 §3.2）+ 内部滚动。
- 与裸文本命令形成明确区分：一个无框、一个有框。

### 2.3 槽位切换的落点

`SkillDetailModal` 当前把 `EnvironmentChecklist`（含命令预览）与 `ProvisionConsole` 上下并列渲染。改为**互斥**：

- 命令预览从 `EnvironmentChecklist` 中**移出**（该组件只负责清单 + 头部汇总）。
- 新增一个槽位：`logs.length > 0 || provisionBusy ? <ProvisionConsole/> : <CommandPreview/>`。
- `CommandPreview` 为新拆出的小组件（裸文本），或内联在 modal 中；命令数据来自 `preflight.commandPreview` / `preflight.installer`。

---

## 3. 高度稳定（消除抖动）

### 3.1 重新检测不清空列表（核心修复）

问题根因在 `useSkillsPage.handlePreflight`：请求前 `setPreflightPlan(null)`，导致面板掉回骨架。

改法：

- **保留旧 plan**，不在请求前置空。`handlePreflight` 去掉 `setPreflightPlan(null)`（仅在真正拿到新结果时替换，出错时保留旧值或走错误提示）。
- 用一个独立的「检测中」态（现有 `preflightBusy`）驱动视觉：检测期间列表整体降透明度（如 `opacity-60 transition-opacity`），头部汇总显示 `● 检测中`。
- **骨架只在首次加载出现**——即从来没有过 plan（`preflightBusy && !preflight`）时。有过 plan 后的每次重新检测都复用旧列表，高度不动。

### 3.2 日志区固定高度

`ProvisionConsole` 的日志区当前是 `max-h-64`（内容从 0 长到 64 会一路撑高）。改为**固定高度**（`h-64` 或约定值）：空态「暂无日志」也占满同样高度，日志再多也只在内部滚动，弹窗高度恒定。

### 3.3 首次进面板的一次性跳动 —— 不额外处理

首次从「骨架」切到「真实列表」仍会有一次高度变化。**决定不为此加面板 min-height**：依赖数量本就不固定，硬设最小高度会让依赖少的 skill 留白，代价大于收益。§3.1 和 §3.2 已消除两个真实的反复抖动源（重新检测、日志增长），首次一次性跳动可接受。

（可选缓解，非必须：把首屏骨架行数配平到「1 运行时 + 3 依赖 + 命令区」的典型高度，降低跳动幅度。实施者可自行斟酌，不做硬性要求。）

---

## 4. 圆角克制

当前 `SkillDetailModal` runtime 面板用 `rounded-panel`(12px)，日志框也是 `rounded-panel`(12px)。收敛为最多两级：

- 依赖清单本身无独立圆角容器（裸清单，靠间距）。
- 日志框：`rounded-card`(10px)。
- 若保留 runtime tab 的外层面板容器（`bg-detail-bg`），用 `rounded-panel`(12px)；否则可去掉该外层盒子让内容直接贴 tab 内容区（更符合「无模块盒子」，实施者按视觉平衡决定，但**不得混用超过两级圆角**）。

遵循 `.agent/skills/web-design/SKILL.md`：`@theme` 令牌、禁止任意值、用间距而非色块/边框分层。

---

## 5. 涉及文件

| 文件 | 改动 |
|---|---|
| `packages/web/src/features/Skills/EnvironmentChecklist.tsx` | 行结构改三列网格 + 左侧色点导轨；删除逐行 `border-t`；移出命令预览；新增头部状态汇总 |
| `packages/web/src/features/Skills/ProvisionConsole.tsx` | 日志区 `max-h-64` → 固定高度；圆角 `rounded-panel` → `rounded-card` |
| `packages/web/src/features/Skills/SkillDetailModal.tsx` | 命令/日志改为互斥槽位；检测中降透明度；圆角收敛；新增（或内联）`CommandPreview` |
| `packages/web/src/features/Skills/useSkillsPage.ts` | `handlePreflight` 去掉请求前 `setPreflightPlan(null)`，保留旧列表 |
| `packages/web/src/features/Skills/types.ts` | 若拆出命令预览/汇总，可能新增小的格式化辅助（如「n 项待处理」计数） |

---

## 6. 明确不做的事（Non-goals）

- ❌ 改弹窗外壳、宽度、tab 栏、meta 条、文档 tab
- ❌ 改后端 / API / 数据结构
- ❌ 改依赖满足状态的检测逻辑与 SSE 协议
- ❌ 给面板加硬性 min-height
- ❌ 从日志文本解析 per-依赖进度（上一轮已排除，仍不做）
- ❌ 依赖单独安装（保持批量）

---

## 7. 验收标准

1. 依赖清单：色点在最左垂直成线，状态短词右边缘齐平，行与行之间无横线。
2. 点「重新检测」：已有列表在位、降透明度、头部显示「检测中」，**弹窗高度不变**；仅首次加载显示骨架。
3. 安装命令为无框裸文本；开始安装后同一位置换成有框定高日志区。
4. 安装日志从 0 条增长到撑满不改变弹窗高度（内部滚动）。
5. runtime 面板圆角不超过两级。
6. `pnpm -F @clawbot/web exec tsc --noEmit` 通过；无 Tailwind 任意值。
