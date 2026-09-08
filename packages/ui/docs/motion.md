---
title: 动效 Motion
description: Clawbot UI 的动效 token 体系：语义时长、缓动曲线与全局动效降级。
sidebar: false
---

# 动效 Motion

动效和颜色一样是 token：所有 `transition` / `animation` 的 duration 一律引用
`--duration-*`，缓动引用 `--ease-*` 语义曲线，组件 CSS 中不出现字面量时长。这让动效具备和
配色一致的三个能力——**全局一致**（改一个 token 全库换挡）、**可审计**（lint 扫描字面量
时长归零）、**可降级**（reduced-motion 收敛为一个媒体查询覆盖）。

## 原则

1. **语义命名**：`entrance / exit / spring` 表达"用在哪"，不表达曲线形状。
2. **少而准**：4 档时长、4 条曲线封顶；出现第 5 档需求先回到场景判断，不扩表。
3. **入退有别**：入场减速（entrance）、退场加速（exit）；退场后仍停留在视口附近的元素
   （侧面板、折叠区）用 `standard`，`exit` 只给"永久消失"的元素。
4. **克制过冲**：`spring` 只用于 Switch / Slider / ToggleGroup 的 thumb 物理感；
   CSS `cubic-bezier` 过冲是物理弹簧的近似，真 spring 属于应用层编排（见下文）。

## 时长档位

| Token                | 值    | 场景                            | 对标                          |
| -------------------- | ----- | ------------------------------- | ----------------------------- |
| `--duration-instant` | 80ms  | 按压反馈、菜单项高亮            | Carbon fast-01（70ms）        |
| `--duration-fast`    | 140ms | hover、颜色/边框/阴影           | Carbon fast-02 ～ moderate-01 |
| `--duration-base`    | 200ms | 图标旋转、thumb 位移、小浮层    | M3 short4（200ms）            |
| `--duration-slow`    | 320ms | Dialog 进出场、focus、Accordion | Carbon moderate-02 ～ slow-01 |

档位约 1.4 倍几何递进（80 → 140 → 200 → 320），符合感知规律，混用时不易"差不多"。
管理台是高频扫描场景，封顶 320ms，不设更高档位。

<code src="./demos/duration-ladder.tsx"></code>

## 缓动曲线

| Token             | 值                                  | 语义                                |
| ----------------- | ----------------------------------- | ----------------------------------- |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)`        | 中性对称（= Material 3 emphasized） |
| `--ease-entrance` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | 减速入场                            |
| `--ease-exit`     | `cubic-bezier(0.4, 0, 1, 1)`        | 加速退场                            |
| `--ease-spring`   | `cubic-bezier(0.34, 1.4, 0.64, 1)`  | 轻微过冲（回弹系数 1.4）            |

<code src="./demos/easing-compare.tsx"></code>

## 交互式编辑器

拖动控制点调整 `cubic-bezier`，选择时长档位，入场/退场双轨预览，一键复制
transition 声明。打开"模拟 reduced-motion"可直观看到全局降级的效果。

<code src="./demos/easing-playground.tsx"></code>

## 组件动效对照

| 组件                         | 动效                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Button / Toggle / Pagination | 状态色 + 按压位移 `fast · standard`                                                |
| Input / Select trigger       | focus 边框与光晕 `slow · standard`                                                 |
| Switch / Slider thumb        | thumb 位移 `base · spring`，轨道颜色 `fast · standard`                             |
| Select / Tooltip / 菜单浮层  | 入场 `fast · entrance`（从 `--transform-origin` 展开），退场 `instant/fast · exit` |
| Dialog                       | 内容与遮罩入场 `slow · entrance/standard`，退场 `fast · exit`                      |
| Accordion / 下拉箭头         | chevron 旋转 `base · entrance`                                                     |
| Breadcrumb                   | 颜色与回退位移 `fast · standard`                                                   |

## reduced-motion 全局降级

所有动效时长都引用 `--duration-*` token，因此 `prefers-reduced-motion` 的处理收敛为
`src/style.css` 中对 4 个变量的单一覆盖，不需要任何逐组件的 `!important` 扫射：

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

验证方式：DevTools Rendering 面板模拟 `prefers-reduced-motion: reduce`，Dialog /
Tooltip / Select 的进出场应无可见动画。字面量时长会静默绕过该覆盖——动效 lint
扫描（见项目 SKILL.md）用于保持归零。

## 生态对标与引擎边界

token 语义与数值经成熟设计系统校准：`standard` 与 Material 3 `emphasized`
（`cubic-bezier(0.2, 0, 0, 1)`）完全一致；`standard / entrance / exit` 三分法对应
Carbon 的 productive 曲线族；时长档位落在 Carbon（70–400ms）与 M3（50–400ms）之间。

引擎选型分层：**组件库零动效依赖**，全部场景由 CSS transition + Base UI 的
`data-starting-style` / `data-ending-style` 卸载协调覆盖。应用层需要布局 FLIP、
手势、图表数据插值等编排时，按需引入 [Motion](https://motion.dev)（原
framer-motion，`motion/react`）——它与 Base UI 的两套卸载机制不应在同一组件内混用。
