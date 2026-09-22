---
title: 动效 Motion
description: 动效和颜色一样是 token——时长与缓动各有语义档位，全库共享，一次降级。
sidebar: false
toc: false
---

# 动效 Motion

## 时长

<code src="./demos/duration-ladder.tsx"></code>

## 缓动

<code src="./demos/easing-compare.tsx"></code>

入场减速，退场加速；退场后仍停在视口附近的元素（侧面板、折叠区）用 standard。

## Playground

<code src="./demos/easing-playground.tsx"></code>

## 用在哪

| 组件                         | 动效                                      |
| ---------------------------- | ----------------------------------------- |
| Button / Toggle / Pagination | `fast · standard`                         |
| Input / Select focus         | `slow · standard`                         |
| Switch / Slider thumb        | `base · spring`                           |
| Select / Tooltip / 菜单浮层  | 入 `fast · entrance`，出 `instant · exit` |
| Dialog                       | 入 base · entrance，出 fast · exit        |
| Accordion chevron            | `base · entrance`                         |

## 降级

全部时长引用 token，所以降级只是一次覆盖：

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
