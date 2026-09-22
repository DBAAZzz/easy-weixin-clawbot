# 供应商配置页 Console 化重构设计

日期：2026-09-22
状态：已确认（用户已批准，跳过 spec 评审门，直接实现）

## 背景与目标

供应商配置新建/编辑页（`/model-config/providers/*`）当前的顶部操作栏和表单区是"圆角浮卡浮在留白里"的形态：顶栏四周有留白、`rounded-control` 圆角，表单区是 `rounded-section` 大卡片套小控件。用户希望改为 Console（控制台）形态：

- 顶部操作栏全宽、吸附顶部、左右上下零留白、无圆角
- 下方工作区随之为方角、左右出血贴边，区块靠 1px 细线分区而非卡片套卡片
- 表单控件整体使用组件库 `sm` 规格（32px 高，当前 md 为 40px），Select 宽度收敛

## 范围与不变量（用户显式约束）

- **只改** `packages/web/src/features/ProviderConfig/index.tsx` + `packages/web/src/styles.css`（新增工具类）
- **不改** `AppShell.tsx`、其他 20 个页面、`@clawbot/ui` 组件库
- **不改**任何表单逻辑：`providerConfigForm.ts`、校验、API 调用、路由跳转

备选方案中被否决的：全局布局升级（影响所有页面）、先做组件再推广、仅去圆角保留浮卡、只改顶栏保留圆角内容。用户在视觉伴侣 mockup 对比中选定"Console 工作区"方向，随后将范围收缩为单页。

## 页面结构（自上而下两层）

1. **全宽顶栏**：左右通过负 gutter 出血贴边；无圆角、无阴影；**普通流内元素（非 sticky）**，页面本身不滚动所以天然贴顶；`bg-panel` + `border-b border-line`；高度 56px（`h-16`，根字号 14px 下 = 4rem）；左侧 Breadcrumb、右侧操作按钮（删除[编辑态] / 取消 / 创建·保存，均 `size="sm"`）；内 padding `px-5 sm:px-6` 与表单行对齐。
2. **方角工作区**：横向出血贴左右边缘、顶部与顶栏相接；无外框阴影、外边框；`flex-1 min-h-0 overflow-y-auto` **在页面根节点（`h-dvh`）内部滚动**；内部靠细线分区：
   - 新建态：左侧预设栏（`xl:w-observability-search` 280px、与表单间用 `divide-x` 细线、`xl:sticky xl:top-0` 吸附在工作区顶部、超高内部滚动）+ 右侧表单
   - 编辑态：单列表单占满（现状逻辑不变）

## gutter 对冲机制（关键实现点）

负 margin 三档值必须与 AppShell 滚动容器的 `p-4 md:p-6 xl:p-8` 严格对应（**注意：本应用 `html` 根字号为 14px**，Tailwind 间距与 rem 均按 14px 缩放，`p-8` 实际为 28px）。在 `styles.css` 以 CSS 变量 + `@utility` 单点定义（`--page-gutter` 按 48rem/80rem 断点切换），页面根节点（`page-bleed-page`，上下出血）、顶栏（`page-bleed-header`，横向出血）、工作区（`page-bleed-body`，横向出血）共用。

**实现注意（已验证的坑）**：
- 顶栏**不能用 sticky**：Chrome 把 sticky 元素的吸附矩形压在滚动容器 content box 之内，带 padding-top 的滚动容器里 sticky 顶栏永远贴不了视口顶部（会被推下 gutter，遮挡内容）；负 margin / 负 inset 各种组合均有一态失败。最终方案是页面根节点 `h-dvh` + 顶栏普通流内元素 + 工作区内部滚动，各状态（scroll-0 / 滚动中 / 内容不足一屏）全部确定。
- 页面根节点负 margin 若塌陷穿透到 sticky 子元素，Chrome 会把吸附位置下移一个 gutter。

**耦合点标注**：AppShell padding 若将来变更，必须同步 `--page-gutter`（styles.css 内有注释说明）。

## 表单细节

- 表单行：行间 `border-t border-line` 细线分区（首行无），label 列 240px，控件列 `max-w-md`（448px）收敛
- 所有 Input/Select 传 `size="sm"`；Select 保留 `fullWidth`（宽度随控件列收敛，不再横贯整面板）
- 「添加模型」虚线按钮高度收敛为 32px；建议模型 chips 不变
- 预设项密度同步收紧：logo `size-8`、条目 `rounded-card px-2.5 py-2`

## 验收标准

1. 顶栏贴顶、左右零留白、无圆角，滚动时吸附 + 毛玻璃生效
2. 1280 / 1440 / 1920 宽度下出血与内容对齐无错位（三档断点验证）
3. 编辑态（无预设栏）同样成立；内容不足一屏时工作区仍贴满至底部
4. 其他页面视觉零变化（AppShell 未动）
5. `pnpm -F @clawbot/web exec tsc --noEmit` 通过

## 风险

- 负 gutter 与 AppShell padding 耦合 → CSS 变量单点定义 + 注释标注
- sticky 在 overflow 容器内贴顶依赖浏览器标准行为（sticky 相对 scrollport），实现时需人工验证
