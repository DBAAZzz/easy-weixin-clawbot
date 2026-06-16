# Playground 可交互控件方案（双向绑定）

> 目标：让 `packages/ui` 每个组件 demo 的**预览区组件本身可直接交互**（输入、拖拽、选择），并与 Tweaks 面板的对应控件**实时双向同步**。本方案为实现规格，供执行方直接落地。

## 背景与根因

`packages/ui/src/Playground/Playground.tsx` 提供 `StoryBook` + `useControls`：`useControls` 只**读** store 的值，没有暴露**写**能力给 demo。于是交互型组件的 demo 只能把值绑成「受控 + 无 write-back」，预览区组件被冻住，无法操作。

典型问题（`Input/demos/playground.tsx`）：

```tsx
<Input
  value={controls.value}   // 受控，绑定 store
  readOnly                  // 只读 → 吞掉键盘输入
/>
```

- `readOnly` 直接让组件无法输入；
- 即便去掉 `readOnly`，受控 `value` 没有 `onChange` 写回 store，React 每次输入又重置回 `controls.value`，照样打不进去。

同类被冻住的 demo：

- `Slider/demos/playground.tsx:22` — `<Slider value={controls.value} />`，无 `onValueChange`，拖不动。
- `Select/demos/playground.tsx:32` — `onChange={() => {}}`（no-op），预览里选了不生效。

`Playground.tsx` 本身无 bug，缺的是「让 demo 把组件内部变化写回 store」的能力。

## 方案：给 `useControls` 配一个写回 setter

新增 `useSetControl` hook，暴露 store 的 `setValue`。demo 把预览组件的 `onChange`/`onValueChange` 接到这个 setter，实现 **组件内操作 ↔ 面板控件** 双向同步。一次改动惠及所有交互型组件，最贴近 Storybook 体验。

设计要点：

- 不改 `useControls` 现有签名（返回值仍是 values 对象），**非破坏性**，其余 demo 不受影响。
- `useSetControl` 的 `store` 入参与 `useControls` 对称：默认走单例 `defaultStore`；多 demo 同页时配 `useCreateStore()` 传同一个 store。
- store 已有 `setValue(name, value)` 与 `useSyncExternalStore` 订阅，setter 写入会触发面板与预览一起重渲染，无需额外状态。

## 实现步骤

### 1. `packages/ui/src/Playground/Playground.tsx`

`ControlValue` 类型已存在（`boolean | number | string`），将其 `export`，并新增 `useSetControl`。

- 在顶部 React import 补 `useCallback`：

```tsx
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
```

- 导出 `ControlValue`：

```tsx
export type ControlValue = boolean | number | string;
```

- 在 `useControls` 之后新增 hook：

```tsx
export function useSetControl(options?: { store?: ControlsStore }) {
  const store = options?.store ?? defaultStore;
  return useCallback(
    (name: string, value: ControlValue) => store.setValue(name, value),
    [store],
  );
}
```

### 2. `packages/ui/src/Playground/index.ts`

补充导出：

```ts
export {
  StoryBook,
  useControls,
  useCreateStore,
  useSetControl,
  type ControlsSchema,
  type ControlsStore,
  type ControlValue,
} from "./Playground.js";
```

### 3. 修每个被冻住的交互 demo

写回时 `name` 必须与 `useControls` 里的 key 一致（下面都是 `"value"`），写回的值类型要匹配组件 `onChange` 的出参类型。

**`Input/demos/playground.tsx`** — 去掉 `readOnly`，接 `onChange`：

```tsx
import { Input } from "../index.js";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";

export default function InputPlayground() {
  const controls = useControls({
    placeholder: "例如 gpt-5-mini",
    value: "",
    disabled: false,
  });
  const setControl = useSetControl();

  return (
    <StoryBook>
      <div className="w-80">
        <Input
          disabled={controls.disabled}
          placeholder={controls.placeholder}
          value={controls.value}
          onChange={(event) => setControl("value", event.target.value)}
        />
      </div>
    </StoryBook>
  );
}
```

**`Slider/demos/playground.tsx`** — Slider 的回调是 `onValueChange?: (value: number) => void`：

```tsx
const setControl = useSetControl();
// ...
<Slider
  disabled={controls.disabled}
  value={controls.value}
  onValueChange={(next) => setControl("value", next)}
/>
```

**`Select/demos/playground.tsx`** — Select 的回调是 `onChange(value: string): void`，把 no-op 换成写回：

```tsx
const setControl = useSetControl();
// ...
<Select
  disabled={controls.disabled}
  options={options}
  size={controls.size as SelectSize}
  value={controls.value}
  onChange={(next) => setControl("value", next)}
/>
```

> 其它 demo（Button / Badge / Card / Accordion / AdminCard / ScrollArea / Sonner / Dialog）若不存在「预览组件值可变但被冻住」的情况，**不要**为了套用而强加 `value` 控件——只修真正需要交互的组件。判断标准：该组件有受控 `value` + 对应 `onChange`，且 demo 当前没接写回。

## 同步更新 ui-design skill 规范

在 `.agent/skills/ui-design/SKILL.md` 的「Demo 与 Playground 规范」补一条（`.codex/skills/ui-design` 是其符号链接，改一处即可）：

- 交互型组件（值可变：Input / Select / Slider / Switch 等）的 demo **必须**用 `value` + `onChange→useSetControl(name, value)` 做双向绑定，让预览区组件本身可操作并与 Tweaks 面板实时同步；
- **禁止** `readOnly` + 受控值、或 `onChange={() => {}}` 这类把预览组件冻住的写法；
- 纯展示型组件（无可变值）不强加 `value` 控件。

## 验证

每改完跑全套校验，且 docs 站手动确认预览区可输入/可拖拽/可选择，并与面板同步：

```bash
pnpm -F @clawbot/ui typecheck
pnpm -F @clawbot/ui fmt:check
pnpm -F @clawbot/ui lint
pnpm -F @clawbot/ui build
pnpm -F @clawbot/ui docs:build
```

两条 token 违规扫描应为空（本方案基本不涉及样式，但按规范执行）：

```bash
rg -n '(^|\s)(bg|text|border|rounded|shadow|ring|p|px|py|m|mx|my|w|h|min-w|max-w|min-h|max-h|gap|space|size)-\[' packages/ui/src --glob '!*.md'
rg -n '\b(bg|text|border|ring|from|to|via|fill|stroke|outline|divide|decoration)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}\b' packages/ui/src --glob '!*.md'
```

## 交付说明（执行方回复需覆盖）

- 改了哪些文件（Playground + 哪些 demo）；
- 每个交互 demo 的写回 `name` 与值类型；
- 是否同步了 ui-design skill 规范；
- 跑了哪些校验、docs 站交互是否实测通过。
