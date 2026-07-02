# 使用分析页面设计

## 背景

现有可观测性中心面向 Agent 排障和调优，重点是 trace、span、耗时、错误率和异常标记。新增的使用分析页面面向运营和成本视角，回答两个问题：

- 最近 30 天 Agent 使用是否活跃。
- token 消耗主要来自哪些模型，以及各模型的**绝对消耗量**。

### 为什么新增 `usage_events` 表，而不复用 observability 数据

首版曾考虑复用 `trace_spans`（`name = "llm.call"`）聚合 token，但存在**口径硬伤**：

- `trace_spans` **受采样控制**——写入层 `packages/observability/src/storage/queue.ts` 中，汇总行 `traces` 全量写入，但 span 明细仅写入采样命中的（`writeSpans` 只处理 `sampled` 项）。一旦采样率 < 100%，token 图就只反映样本，对「成本/用量」是系统性失真。
- `traces` 表虽全量，但按请求聚合，**没有 `model` 维度**，无法做按模型的绝对量拆分。

按模型的绝对 token 这个事实，只在「每次模型调用产生时」是完整的。让排障用的采样 span 同时承担计量职责，会把上层（用量计量）的完整性诉求泄漏进下层（观测持久化），违反单一职责。因此本设计引入一张**独立的、全量写入的计量事实表 `usage_events`**，由独立的 `UsageStore` port 写入，与 observability 采样链路完全解耦。

## 目标

- 新增独立 Web 页面「使用分析」，路由建议为 `/usage`。
- 展示最近 30 天每日请求活跃热力图。
- 展示最近 30 天按模型拆分的 token 消耗折线图，数值为**全量准确的绝对量**。
- 提供汇总指标：请求总量、token 总量、日均请求、日均 token。
- 保持页面定位和可观测性中心分离，避免排障信息与用量信息混杂。
- 计量写入路径与 observability 采样链路解耦，互不依赖。

## 非目标

- 不做 trace 详情下钻、span 树展示或错误排查。
- 不做成本金额估算。
- 不做账号、会话、模型筛选（但 `usage_events` 预留维度，后续零改表即可扩展）。
- 不回填历史数据：`usage_events` 自上线起累计，上线初期页面数据随时间补齐，属预期行为。
- 计量范围仅覆盖**会话主链路（chat runner）的模型调用**；标题生成、记忆提取、心跳、视觉等后台模型调用首版不计入（与原 `name = "llm.call"` 仅来自 runner 的口径一致）。
- 不重构现有 `DistributionCharts.tsx`（详见前端设计）。

## 数据采集（Agent 层）

### UsageStore port

在 `packages/agent/src/ports/usage-store.ts` 新增 port，与现有 `MessageStore`/`TapeStore` 同构：agent 定义接口，server 用 Prisma 实现，启动时注入。

```ts
export interface RecordUsageParams {
  accountId: string;
  conversationId: string;
  /**
   * 请求级 id，按请求去重统计活跃用，**必填非空**。写入点优先取当前 trace id
   * （chat 主链路始终在 trace 上下文内），缺失时生成兜底。通常等于 trace id，
   * 因此可与 `traces` 表关联回查排障。
   */
  requestId: string;
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStore {
  /** 异步入队、批量落库，fire-and-forget，不阻塞会话主链路。 */
  queueRecord(params: RecordUsageParams): void;
}
```

通过 `ports/slot.ts` 的 `createPortSlot` 导出 `setUsageStore` / `getUsageStore`，并在 `ports/index.ts` 中 re-export。

### 写入点

复用现有消息持久化的同一个出口 `packages/agent/src/chat.ts` 的 `createMessageTracker.onMessage`（约 `chat.ts:196`）。该回调已经在逐条消费 runner 产出的消息，每条 assistant message 即一轮 `llm.call`，且 `message.model` / `message.usage` 是**结构化、未经采样的完整数据**。

在 ASSISTANT 分支并排追加一次计量写入：

```ts
// isEmptyAssistant 复用上文 isEmptyAssistantMessage(packages/agent/src/utils/chat-utils.ts:48)
// 的判定，与「跳过持久化空 assistant」保持一致，避免空错误响应被计量。
if (!isEmptyAssistant && message.role === MESSAGE_ROLE.ASSISTANT && message.usage) {
  getUsageStore().queueRecord({
    accountId,
    conversationId,
    // getTraceId() 已由 @clawbot/observability 导出（trace/async-context.ts:48），返回 string；
    // chat 主链路始终在 trace 内，理论非空，仍用 randomUUID 兜底保证 requestId 必填。
    requestId: getTraceId() || randomUUID(),
    model: message.model ?? "unknown",
    provider: message.provider,
    inputTokens: message.usage.input,
    outputTokens: message.usage.output,
  });
}
```

要点：

- **与采样解耦**：这是一个与「消息持久化」「observability span」平级的兄弟 sink，三者互不依赖；`queue.ts` 采样逻辑一行不动。
- **gate 在 `!isEmptyAssistant`**：与持久化逻辑同源，避免空错误响应（可能带归一化的 `{ input: 0, output: 0 }` usage）被记为一次请求。
- 一次非空 assistant message（= 一轮模型调用）写一行。**只要带 usage 就记录，不再按 total token 是否为 0 过滤**——output 为 0 但 input 已产生消耗，仍是成本。
- `requestId` 必填非空：`getTraceId()` 取当前 trace id，理论非空；`|| randomUUID()` 仅作防御兜底。`getTraceId` 现成已导出，实现时加进 chat.ts 现有 `@clawbot/observability` import 即可。

## 数据库设计（Server 层）

新增 Prisma 模型 `UsageEvent`（表名 `usage_events`），append-only 事实表：

```prisma
model UsageEvent {
  id             BigInt   @id @default(autoincrement())
  accountId      String   @map("account_id") @db.Text
  conversationId String   @map("conversation_id") @db.Text
  // 请求级 id，必填非空，按请求去重统计活跃用；通常等于 trace id，可关联 traces 回查。
  requestId      String   @map("request_id") @db.Text
  model          String   @db.Text
  provider       String?  @db.Text
  inputTokens    Int      @map("input_tokens")
  outputTokens   Int      @map("output_tokens")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([createdAt(sort: Desc)], map: "idx_usage_events_created")
  @@index([model, createdAt(sort: Desc)], map: "idx_usage_events_model_created")
  @@index([accountId, createdAt(sort: Desc)], map: "idx_usage_events_account_created")
  @@map("usage_events")
}
```

- 采用**事实表**而非预聚合日表：避免并发自增 upsert，且保留 `account_id`/`conversation_id` 维度，使「后续扩展」里的账号/会话筛选、成本估算、导出零改表解锁。
- `createdAt` 索引服务 30 天范围聚合；`(model, createdAt)` 服务按模型聚合；`(accountId, createdAt)` 为后续账号筛选预留。
- **保留策略**：纯分析数据，应配套周期清理（如保留 90 天或可配），避免无界增长。具体清理任务实现可后续接入现有定时任务体系，本设计仅声明约束。

### UsageStore 实现与队列生命周期

server 端实现 `UsageStore`，复用现有消息持久化的**异步批量队列**模式（参考 `packages/server/src/db/messages.ts`），把 `queueRecord` 收集后批量 `createMany`，避免每次调用一次同步写库。除写入外，必须对齐现有队列的生命周期约定，否则关机会丢最后一批计量：

- **`flush()`**：暴露主动 flush，供关机和背压触发（参考 `messages.ts:309 flushQueue` / `queue.ts:71 flush`）。
- **shutdown flush**：server 优雅关机流程中调用一次 `flush()`，把残留队列落库。
- **pending 计数 + health**：暴露 `getPendingUsageWriteCount()`，并在 `packages/server/src/api/routes/health.ts` 增加 `pending_usage_writes` 字段，与现有 `pending_message_writes`/`pending_trace_writes` 对齐。
- **写入失败**：可重试入队 + 上限丢弃，沿用消息队列的退避策略；失败绝不冒泡到会话主链路。

## 数据口径

整页**单一数据源 `usage_events`**，因此各图天然口径一致，且都为全量准确值（不受采样影响）。

### 活跃热力图

- 数据来源：`usage_events`。
- 时间范围：最近 30 天。
- 聚合方式：按 `created_at` 的自然日聚合。
- 计数口径：`request_count = COUNT(DISTINCT request_id)`，即当天去重后的请求数。`request_id` 必填非空，所有计量行都参与去重，不会出现「有 token 消耗却不计活跃」的漏计。
- 展示字段：
  - `date`：日期，格式 `YYYY-MM-DD`。
  - `request_count`：当天去重请求数。
  - `level`：颜色强度等级，0 表示无请求，1-4 表示由浅到深。

热力图采用 GitHub contributions 的语义。30 天范围使用紧凑月度热力图，而非完整 12 个月贡献图。

### Token 折线图

- 数据来源：`usage_events`。
- 时间范围：最近 30 天。
- 聚合维度：`created_at` 的自然日 + `model`。
- token 口径：
  - `input_tokens`：输入 token 之和。
  - `output_tokens`：输出 token 之和。
  - `total_tokens = input_tokens + output_tokens`。
- 模型为空时归类为 `unknown`（写入侧已兜底，查询侧再防御一次）。

折线图默认每个模型一条线，纵轴为 total token；数值为绝对量。tooltip 可展示当天各模型的 input、output、total。

### 时区

`created_at` 为 `timestamptz`。**聚合时区固定为 `Asia/Shanghai`**（当前环境与业务默认时区即此）；`date_trunc` 与服务端生成的 30 天日期序列必须都用 `Asia/Shanghai`，否则热力图会整体错位一天。若未来面向跨区部署，再引入全局时区配置项替换此常量，本设计先不预留。

## 后端设计

新增使用分析路由模块：

```text
GET /api/usage/overview?window=30d
```

首版仅支持 `30d`。缺省或非法 window 均按 `30d` 处理。

返回结构：

```ts
interface UsageOverview {
  window: "30d";
  totals: {
    requests: number;
    token_total: number;
    avg_daily_requests: number;
    avg_daily_tokens: number;
  };
  activity_days: Array<{
    date: string;
    request_count: number;
    level: 0 | 1 | 2 | 3 | 4;
  }>;
  token_series: Array<{
    date: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  }>;
  model_totals: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    ratio: number;
  }>;
}
```

### 查询策略

- 服务端生成最近 30 天日期序列，并对缺失日期补 0（按上节约定的时区）。
- `activity_days`：`usage_events` 按天聚合 `COUNT(DISTINCT request_id)`。
- `token_series`：`usage_events` 按天和模型聚合 token。
- `model_totals`：由 token 聚合结果二次汇总，`ratio = 模型 total / 全量 total`；因单一数据源，`Σ ratio = 1`，且 `Σ model_totals.total = totals.token_total`。
- `totals.requests`：30 天 `COUNT(DISTINCT request_id)`；`totals.token_total`：30 天 `SUM(input + output)`；日均按 30 天均摊。
- `level` 由 30 天内单日最大请求数归一化分桶：
  - `0`：当天请求数为 0。
  - `1-4`：按 `max` 等比例分桶（阈值公式实现时写死，避免歧义）。

### BigInt 收口

Postgres 的 `COUNT(*)` / `SUM(...)` 返回 `bigint`，到 JS 是 `BigInt`，`JSON.stringify` 会**直接抛错**。所有聚合结果必须在 service 层用 `Number()` 收口后再进入响应对象。

### 类型边界

- shared 包新增 `UsageOverview` 类型，保持 web 和 server 之间的响应契约一致。
- server 新增 `UsageRouteService`（或在使用分析 service 中封装查询逻辑），承载聚合与 BigInt/时区收口。
- API route 只负责参数解析和 JSON 返回，不承载聚合逻辑。

## 前端设计

技术栈现状：web 为 React 19 + Vite + Tailwind v4；`@clawbot/ui` 提供 `Card`/`Tooltip` 等组件，主题为分层 CSS 变量 token（`--color-accent` 等）；现有图表 `features/Observability/components/DistributionCharts.tsx` 为纯 CSS 手搓。

### 契约与落点

- 路由：`/usage`，侧边栏文案：`使用分析`。
- API：`packages/web/src/api/usage.ts`，消费 `GET /api/usage/overview`。
- Hook：`packages/web/src/hooks/useUsageOverview.ts`，返回 `UsageOverview` 及 loading/error。
- 页面：`packages/web/src/features/Usage/index.tsx`；图表组件放 `features/Usage/components/`，镜像 Observability 的结构。
- 外壳复用 `@clawbot/ui` 的 `Card`，空态复用现有 `ChartEmpty` 风格。
- **数据→视图的转换放在 feature 层**（把 `token_series` 透视成 `Map<model, points[]>`），图表组件只管渲染。

### 图表方案：分而治之

两张图用不同技术，按各自最契合的工具选型，视觉一致性交给 token 统一。

**活跃热力图 —— 手搓，不引库。**

- 后端已算好 `level 0-4`，前端只把 5 个等级映射到 5 个 token 颜色（建议在 `tokens.css` 定义 `--usage-heat-0..4`，或复用 accent 梯度）。
- 30 个固定尺寸方块按周排列的 grid/div，沿用 `DistributionCharts` 的手搓风格，~40 行，零依赖、天然吃主题/暗色。
- hover 显示日期 + 请求数，用 `@clawbot/ui` 的 `Tooltip`。
- 不使用 `@visx/heatmap`：它面向稠密矩阵热力图，套日历格反而更重。

**Token 折线图 —— 用 visx 的 `@visx/xychart`。**

- 多系列折线 + 坐标轴 + 最近点 tooltip + 响应式宽度，正是 visx 主场。用组合式高层 API `@visx/xychart`（`XYChart` + `LineSeries` + `Axis` + `Grid` + `Tooltip`），而非裸 primitives，~60-80 行即可，仍完全可主题化。
- 依赖只装用到的子包：`@visx/xychart @visx/scale @visx/responsive`（`ParentSize` 取宽度，高度用 token 固定，对齐现有 `h-observability-chart`）。不装 meta 包。
- **颜色走 CSS 变量**：`stroke="var(--color-accent)"` 之类，自动跟随主题/暗色，不硬编码 hex。多系列调色板从现有 accent 梯度取（`--color-accent`/`--color-accent-strong`/`--color-success-solid`/`--color-ink`/`--color-danger`…），或定义 `--chart-series-1..n`，保持品牌一致。
- 单模型时仍用同一折线结构（一条线）。

### 注意：visx 与 React 19 的 peer 兼容

visx 部分子包的 `peerDependencies` 历史上卡在 `react ^16-18`。本项目为 React 19，安装前需确认所选 visx 版本是否声明支持 React 19；若报 peer 警告，在根 `pnpm` 配置加 `overrides`/`peerDependencyRules` 放行（visx 用的都是稳定 API，运行时可正常工作）。

### 不在本次范围

- **不重构** `DistributionCharts.tsx`：它无轴/无 tooltip/无交互，是纯 CSS 比例条，改 visx 是 churn 无收益。「CSS 柱图 + visx 折线图」混用是正常做法，一致性由 token 兜。若将来柱图需要数值轴/刻度/tooltip/堆叠，再抽共享 `<BarChart>` 基元。

## 错误和空态

- API 请求失败：页面顶部展示轻量错误提示，并保留刷新按钮。
- 无 `usage_events` 数据（如刚上线、未回填历史）：
  - 汇总指标全部为 0。
  - 热力图全部为 0 级。
  - token 图表展示空态。
  - 随上线后会话累计，数据逐日补齐，属预期。
- 某天无数据：折线图该天补 0，避免断线。
- 某行缺失 `model`：归入 `unknown`。
- token 字段理论上非空（schema 为 `Int`），写入侧已兜底；查询侧对意外空值按 0 处理。

## 测试计划

### Agent 层（计量写入）

- 非空 assistant message 带 `usage` 时，`UsageStore.queueRecord` 被调用，字段映射正确（model/provider/input/output/requestId）。
- **空 assistant（`isEmptyAssistantMessage` 命中）不写入**，即便携带 `{ input: 0, output: 0 }` 归一化 usage。
- 无 `usage` 的 assistant message 不写入。
- output token 为 0 但 input > 0 的非空 assistant **仍写入**（input 是成本）。
- `requestId` 必填非空：`getTraceId()` 有值时取其值，为空时走 `randomUUID()` 兜底。
- `message.model` 缺失时落 `unknown`。
- 计量写入失败/未注入 port 不影响会话主链路（fire-and-forget，不抛出）。

### Server 层（聚合查询与队列生命周期）

- 0 数据时返回完整 30 天日期序列（全 0）。
- 单日多行按 `COUNT(DISTINCT request_id)` 聚合为正确请求数（同一请求多轮只计一次）。
- 多模型 token 按日和模型正确聚合，绝对量准确。
- 缺失日期补 0。
- `model` 为空归入 `unknown`。
- `Σ model_totals.total == totals.token_total` 且 `Σ ratio == 1`。
- 聚合结果经 `Number()` 收口，响应可 `JSON.stringify` 不抛 BigInt 错误。
- 日期序列与聚合统一用 `Asia/Shanghai`，边界日不错位。
- `flush()` 后 pending 队列清空；shutdown 触发 flush，残留批次不丢。
- health 返回 `pending_usage_writes`，反映当前未落库条数。

### 前端

- 加载态、错误态、空态正常展示。
- 热力图固定渲染 30 个方块；`level` 正确映射到颜色等级。
- 多模型时 `token_series` 透视为正确条数的折线，图例与 `model_totals` 一致；单模型不破坏布局。
- 颜色取自 CSS 变量，明暗主题切换下图表跟随。
- 桌面/移动端图表不重叠、不溢出（`ParentSize` 响应式宽度）。

## 后续扩展

`usage_events` 的维度已预留，后续可在同一表上扩展：

- 账号筛选、会话筛选（已带 `account_id`/`conversation_id`）。
- 模型隐藏/显示切换。
- 成本估算（按模型单价 × token）。
- 7 天、90 天、自定义时间范围。
- CSV 导出。
- 将后台模型调用（标题/记忆/心跳/视觉）纳入计量范围。
