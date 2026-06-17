---
title: Icons
group: 基础组件
description: Clawbot UI 对外暴露的图标集合，内部基于 Hugeicons 封装。
---

# Icons

Clawbot UI 对外暴露的图标集合。图标内部基于 Hugeicons 封装，业务侧只使用 `@clawbot/ui` 的稳定图标命名。

## Playground

<code src="./demos/playground.tsx" nopadding></code>

## APIs

### IconProps

| 属性        | 描述                         | 类型                      | 默认值           |
| ----------- | ---------------------------- | ------------------------- | ---------------- |
| className   | 自定义类名，通常用于控制尺寸 | `string`                  | -                |
| color       | 图标颜色。默认继承文字颜色。 | `string`                  | `'currentColor'` |
| strokeWidth | 描边宽度。                   | `number`                  | `1.8`            |
| ...svgProps | 继承 SVG 属性。              | `SVGProps<SVGSVGElement>` | -                |

### 图标导出

当前导出 `ActivityIcon`、`PulseIcon`、`ArrowRightIcon`、`BoltIcon`、`BookIcon`、`ChatIcon`、`GridIcon`、`HomeIcon`、`LinkIcon`、`RssIcon`、`QueueIcon`、`PuzzleIcon`、`ScanIcon`、`PencilIcon`、`CheckIcon`、`XIcon`、`SearchIcon`、`StackIcon`、`TerminalIcon`、`LogOutIcon`、`WebhookIcon`、`CopyIcon`、`TrashIcon`、`RefreshIcon`、`PlusIcon`、`UploadIcon`、`KeyIcon`、`LockIcon`、`ClockIcon`、`ChevronDownIcon`、`ChevronUpIcon`、`MoreHorizontalIcon`、`HistoryIcon`、`AlertCircleIcon`、`CheckCircleIcon`、`PlayIcon`、`PauseIcon`、`CalendarIcon`、`CpuIcon`、`LayersIcon`、`SlidersIcon`、`GaugeIcon`、`HeartIcon`、`NetworkIcon`、`DiamondIcon`、`SettingsIcon`。
