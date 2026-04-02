# Agent Observability 可观测性系统设计

> 为 AI Agent 建立端到端可观测能力——从微信消息入站到 LLM 推理、工具调用、回复发送，全链路可追踪、可度量、可告警。

## 目标

1. **排查效率**：任意一条用户消息，能在 10 秒内还原完整处理链路（含 prompt/completion 原文）
2. **成本可控**：实时掌握 Token 消耗与 API 调用费用
3. **质量度量**：基于确定性信号自动标记异常 trace（超轮次、工具失败、LLM 错误）
4. **系统健康**：关键指标异常时主动告警
5. **可持续**：采样策略控制存储成本，不随流量线性膨胀

## 核心理念：一条消息，一棵 Trace 树

Agent 与传统 Web 服务最大的区别是**不确定性**——同一个请求可能走 1 轮也可能走 10 轮，可能调 0 个工具也可能调 5 个。观测的核心单位不是 request/response，而是一棵 **Trace 树**：

```text
Trace (traceId = 一次用户消息的完整处理)
│
├─ Span: message.receive        ← 微信消息到达
├─ Span: command.dispatch       ← 命令拦截检查
├─ Span: agent.chat             ← 进入 AI 处理（自动成为子 span 的 parent）
│   ├─ Span: llm.round.1       ← 第一轮 LLM 调用
│   │   ├─ input_tokens: 1200
│   │   ├─ output_tokens: 340
│   │   ├─ latency_ms: 2800
│   │   └─ stop_reason: toolUse
│   ├─ Span: tool.web_search    ← 工具调用
│   │   ├─ args: {query: "..."}
│   │   ├─ latency_ms: 650
│   │   └─ status: ok
│   ├─ Span: tool.get_weather   ← 并行工具调用
│   │   ├─ latency_ms: 120
│   │   └─ status: ok
│   └─ Span: llm.round.2       ← 第二轮 LLM
│       ├─ input_tokens: 2100
│       ├─ output_tokens: 580
│       └─ stop_reason: stop
├─ Span: message.send           ← 回复发送
│   └─ latency_ms: 90
└─ total_ms: 4200
```

---

## 三大支柱

### 1. Tracing（链路追踪）—— "这条消息经历了什么"

#### 核心设计：AsyncLocalStorage 隐式上下文

**为什么不用参数传递**：Agent 调用链深度不确定（`chat()` → `runner.run()` → `tools.execute()` → 具体工具函数 → 可能还有嵌套调用）。显式传参会导致：

- 每新增一个函数签名都要加 `trace?: TraceContext`
- 第三方库回调、Promise.all 并行分支等场景传不进去
- 最终要么埋点残缺，要么代码污染严重

**正确做法**：用 Node.js 内置的 `AsyncLocalStorage`，入口 `run()` 一次，下游任意深度直接 `getActiveTrace()` 取。

```typescript
// packages/server/src/trace.ts

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ============================================================
// 1. Span 数据结构
// ============================================================

export interface SpanData {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTime: number;      // Date.now()
  duration: number;        // ms
  status: "ok" | "error";
  attributes: Record<string, string | number | boolean>;
}

// ============================================================
// 2. TraceContext —— 一次请求的完整上下文
// ============================================================

export class TraceContext {
  readonly traceId = randomUUID();
  readonly accountId: string;
  readonly conversationId: string;
  private spans: SpanData[] = [];

  constructor(accountId: string, conversationId: string) {
    this.accountId = accountId;
    this.conversationId = conversationId;
  }

  addSpan(span: SpanData): void {
    this.spans.push(span);
  }

  getSpans(): SpanData[] {
    return this.spans;
  }

  /** 汇总信息，用于 Trace 表落库 */
  summarize() {
    const llmSpans = this.spans.filter((s) => s.name === "llm.call");
    const toolSpans = this.spans.filter((s) => s.name === "tool.execute");
    const earliest = Math.min(...this.spans.map((s) => s.startTime));
    const latest = Math.max(...this.spans.map((s) => s.startTime + s.duration));
    return {
      traceId: this.traceId,
      accountId: this.accountId,
      conversationId: this.conversationId,
      totalMs: latest - earliest,
      llmRounds: llmSpans.length,
      toolCalls: toolSpans.length,
      inputTokens: llmSpans.reduce(
        (sum, s) => sum + (Number(s.attributes.inputTokens) || 0), 0,
      ),
      outputTokens: llmSpans.reduce(
        (sum, s) => sum + (Number(s.attributes.outputTokens) || 0), 0,
      ),
      stopReason: llmSpans.at(-1)?.attributes.stopReason ?? "unknown",
      hasError: this.spans.some((s) => s.status === "error"),
      error: this.spans.find((s) => s.status === "error")
        ?.attributes.error as string | undefined,
    };
  }
}

// ============================================================
// 3. AsyncLocalStorage —— 隐式上下文 + 自动 span 父子关系
// ============================================================

interface TraceStore {
  trace: TraceContext;
  currentSpanId: string | null;  // 当前活跃 span，自动成为新 span 的 parent
}

const storage = new AsyncLocalStorage<TraceStore>();

/** 入口：创建 trace 并在回调作用域内隐式传播 */
export function runWithTrace<T>(
  accountId: string,
  conversationId: string,
  fn: () => T,
): T {
  const trace = new TraceContext(accountId, conversationId);
  return storage.run({ trace, currentSpanId: null }, fn);
}

/** 下游任意深度：获取当前 trace（不存在则返回 undefined） */
export function getActiveTrace(): TraceContext | undefined {
  return storage.getStore()?.trace;
}

/** 下游任意深度：获取当前 traceId（日志用，无 trace 时返回 "no-trace"） */
export function getTraceId(): string {
  return storage.getStore()?.trace.traceId ?? "no-trace";
}

/**
 * 核心 API：创建 span 并执行异步函数
 *
 * - 自动从 AsyncLocalStorage 获取 parent span
 * - 自动把自己设为子作用域的 parent
 * - 自动计时、自动记录错误
 *
 * 调用方只需要：
 *   const result = await withSpan("tool.execute", { toolName }, async () => {
 *     return tools.execute(name, args);
 *   });
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => Promise<T>,
): Promise<T> {
  const store = storage.getStore();
  if (!store) {
    // 没有 trace 上下文，直接执行（不埋点）
    return fn();
  }

  const spanId = randomUUID();
  const parentSpanId = store.currentSpanId;
  const startTime = Date.now();

  try {
    // 把当前 span 设为子作用域的 parent
    const result = await storage.run(
      { trace: store.trace, currentSpanId: spanId },
      fn,
    );
    store.trace.addSpan({
      spanId,
      parentSpanId,
      name,
      startTime,
      duration: Date.now() - startTime,
      status: "ok",
      attributes,
    });
    return result;
  } catch (error) {
    store.trace.addSpan({
      spanId,
      parentSpanId,
      name,
      startTime,
      duration: Date.now() - startTime,
      status: "error",
      attributes: {
        ...attributes,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

/**
 * 同步版本，用于不需要 async 的场景（如命令拦截检查）
 */
export function withSpanSync<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: () => T,
): T {
  const store = storage.getStore();
  if (!store) return fn();

  const spanId = randomUUID();
  const parentSpanId = store.currentSpanId;
  const startTime = Date.now();

  try {
    const result = fn();
    store.trace.addSpan({
      spanId, parentSpanId, name, startTime,
      duration: Date.now() - startTime,
      status: "ok", attributes,
    });
    return result;
  } catch (error) {
    store.trace.addSpan({
      spanId, parentSpanId, name, startTime,
      duration: Date.now() - startTime,
      status: "error",
      attributes: {
        ...attributes,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
```

#### 关键 Span 埋点位置

| Span                 | 埋点位置                       | 关键属性                                              |
| -------------------- | ------------------------------ | ----------------------------------------------------- |
| `message.receive`    | `processOneMessage()`          | mediaType, textLength                                 |
| `command.dispatch`   | `agent.ts` tryDispatch         | commandName, hit/miss                                 |
| `conversation.lock`  | `withConversationLock()`       | waitTime                                              |
| `history.load`       | `ensureHistoryLoaded()`        | messageCount, cacheHit                                |
| `llm.call`           | `runner.ts` 每轮 LLM 调用     | model, inputTokens, outputTokens, latency, stopReason |
| `tool.execute`       | `runner.ts` Promise.all 内     | toolName, args, resultSize, latency, error            |
| `message.persist`    | `queuePersistMessage()`        | queueDepth, flushLatency                              |
| `message.send`       | `sendMessageWeixin()`          | replyLength, mediaType                                |

#### 埋点效果对比

```typescript
// ❌ 之前：显式传参，调用链每一层都要加 trace 参数
async function chat(accountId, conversationId, trace: TraceContext) {
  await loadHistory(accountId, conversationId, trace);
  await runAgent(messages, trace);
  // trace 传不进第三方库回调...
}

// ✅ 现在：入口 run 一次，下游无感
async function handleMessage(accountId, conversationId, req) {
  return runWithTrace(accountId, conversationId, async () => {
    // 任意深度直接用 withSpan，父子关系自动建立
    const result = await withSpan("agent.chat", {}, async () => {
      await withSpan("history.load", { cacheHit: true }, loadHistory);
      return withSpan("llm.call", { model: "claude-4" }, callLLM);
    });
    // result 已经在正确的 span 树下
  });
}

// runner.ts 里也不需要 trace 参数
async function executeTools(toolCalls) {
  return Promise.all(toolCalls.map((tc) =>
    // withSpan 自动获取上下文，并行分支各自独立
    withSpan("tool.execute", { toolName: tc.name }, () =>
      tools.execute(tc.name, tc.arguments, ctx),
    ),
  ));
}
```

### 2. Metrics（指标）—— "系统整体健康吗"

#### 核心指标定义

```typescript
interface AgentMetrics {
  // ① 请求指标
  request_total: Counter;             // 总请求数 {account, status}
  request_duration_ms: Histogram;     // 端到端耗时分布

  // ② LLM 指标
  llm_rounds_per_request: Histogram;  // 每次请求的轮数分布
  llm_tokens_input: Counter;          // 输入 token 累计
  llm_tokens_output: Counter;         // 输出 token 累计
  llm_latency_ms: Histogram;          // 单次 LLM 调用耗时
  llm_errors_total: Counter;          // LLM 错误 {error_type}

  // ③ 工具指标
  tool_calls_total: Counter;          // 工具调用次数 {tool_name, status}
  tool_latency_ms: Histogram;         // 工具耗时 {tool_name}
  tool_timeout_total: Counter;        // 超时次数

  // ④ 系统指标
  message_queue_depth: Gauge;         // 待写入消息队列深度
  active_conversations: Gauge;        // 活跃会话数
  weixin_api_latency_ms: Histogram;   // 微信 API 耗时
}
```

#### 告警规则

| 条件                              | 级别     | 含义                     |
| --------------------------------- | -------- | ------------------------ |
| LLM P95 延迟 > 10s               | Warning  | 推理变慢，影响用户体验   |
| 工具失败率 > 5%                   | Warning  | 工具服务可能异常         |
| 消息队列深度持续增长              | Critical | 写入跟不上，可能丢消息   |
| 连续 N 条请求 hit max_rounds      | Warning  | 可能是 prompt 设计问题   |
| LLM error 率 > 1%                | Critical | 模型服务异常             |

### 3. Logging（日志）—— "出了问题，细节是什么"

#### 现状

项目已有两套日志：

- **Console Logger**（`packages/server/src/logger.ts`）：彩色、人读友好
- **File Logger**（`weixin-agent-sdk/src/util/logger.ts`）：JSON Lines 写入 `/tmp/openclaw/`

#### 改进：自动注入 traceId

基于 `AsyncLocalStorage`，日志模块无需调用方传参，自动注入 trace 信息：

```typescript
// logger.ts 改造

import { getTraceId } from "./trace.js";

function formatLog(level: string, fields: Record<string, unknown>) {
  return {
    ...fields,
    traceId: getTraceId(),  // 自动从 AsyncLocalStorage 获取
    level,
    timestamp: new Date().toISOString(),
  };
}

// 调用方完全不变
log.tool(accountId, name, args, result);
// 但输出自动带上 traceId：
// {"traceId":"a3f8c2d1-...","level":"tool","accountId":"...x8f2a1",...}
```

关键原则：

- 每条日志自动携带 `traceId`（零改动成本）
- 结构化 JSON 格式，便于机器解析
- 敏感字段脱敏（accountId 仅保留末位标识）

---

## Prompt/Completion 记录策略

**这是排查 Agent 行为问题最核心的数据**。不记录实际的 prompt 和 completion 内容，"10 秒内还原完整处理链路"就是一句空话——你无法回答"它为什么选了这个工具"、"它为什么给了这个回答"。

### 策略矩阵

| Trace 类型 | 记录内容 | 保留时长 | 理由 |
| ---------- | -------- | -------- | ---- |
| **异常 trace**（error / max_rounds / 工具失败） | 完整 prompt + completion 原文 | 30 天 | 排查必需，量小 |
| **采样命中的正常 trace** | 完整 prompt + completion 原文 | 7 天 | 抽样分析质量 |
| **未采样的正常 trace** | 不记录原文，只记 token 数和摘要 | 7 天 | 控制存储 |

### 实现方式

```typescript
// 在 LLM span 的 attributes 中记录
interface LlmSpanAttributes {
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  latencyMs: number;

  // prompt/completion 记录（仅在需要时填充）
  promptSnapshot?: string;      // 发给 LLM 的完整 messages JSON
  completionSnapshot?: string;  // LLM 返回的完整 response JSON
}
```

### 存储位置

prompt/completion 原文**不存在 Trace 汇总表**里（太大），而是存在独立的 `TraceSpan` 明细表的 `payload` 字段中。详见下方 Schema 设计。

### 脱敏规则

- 用户消息中的手机号、身份证号等用正则替换为 `[REDACTED]`
- 记录时机：LLM 调用返回后立即脱敏，脱敏后的版本进入 span payload
- 脱敏规则可配置，默认内置常见 PII 模式

---

## 质量信号（仅确定性指标）

只关注零歧义、可自动判定的信号，不做模糊推断：

| 信号 | 判定规则 | 含义 |
| ---- | -------- | ---- |
| **未完成** | `stopReason === "max_rounds"` | Agent 跑满轮次仍未得出结果 |
| **工具失败** | 任意 `tool.execute` span status === error | 工具调用异常，可能降级回复 |
| **LLM 错误** | 任意 `llm.call` span status === error | 模型服务端错误 |
| **超长耗时** | `totalMs > 30_000`（可配置） | 用户等待时间过长 |
| **高成本** | `inputTokens + outputTokens > 50_000`（可配置） | 单次请求消耗异常 |

这些信号直接写入 Trace 汇总表的 `flags` 字段（位掩码或字符串数组），支持高效筛选。

**明确不做的事**（避免误报）：

- ~~用户 60 秒内发送相似问题 → 可能回复质量差~~（"相似"无法可靠判定）
- ~~会话放弃检测~~（用户可能只是忙了）
- ~~回复长度异常~~（不同场景正常长度差异巨大）

---

## 采样策略

**问题**：每条消息都完整记录 trace + 全量 span + prompt/completion 落库，存储成本随流量线性增长。日活从 1000 到 10 万，写入量直接 100 倍。

### 采样规则

```typescript
interface SamplingConfig {
  /** 正常 trace 采样率（0.0 ~ 1.0），默认 0.1 即 10% */
  normalRate: number;

  /** 以下条件命中时，强制 100% 保留（不受 normalRate 影响） */
  forceRetain: {
    /** 任何 span 出错 */
    hasError: true;
    /** 跑满 max_rounds */
    hitMaxRounds: true;
    /** 端到端耗时超过阈值（ms） */
    totalMsThreshold: 30_000;
    /** Token 消耗超过阈值 */
    totalTokensThreshold: 50_000;
  };
}
```

### 采样时机

**在 trace 结束后决定**（不是开始时）。因为 trace 开始时不知道会不会出错、会不会超长，提前丢弃可能错过关键异常。

```typescript
function shouldPersistTrace(summary: TraceSummary, config: SamplingConfig): boolean {
  // 异常强制保留
  if (summary.hasError) return true;
  if (summary.stopReason === "max_rounds") return true;
  if (summary.totalMs > config.forceRetain.totalMsThreshold) return true;
  if (summary.inputTokens + summary.outputTokens > config.forceRetain.totalTokensThreshold) return true;

  // 正常 trace 按比例采样
  return Math.random() < config.normalRate;
}
```

### 分层持久化

即使未被采样的 trace，**汇总指标仍然记录**（因为 metrics 需要完整统计）：

| 数据层 | 采样命中 | 未采样 |
| ------ | -------- | ------ |
| Trace 汇总行（耗时、轮数、token、flags） | 写入 | 写入 |
| TraceSpan 明细行（每个 span） | 写入 | **不写** |
| Prompt/Completion 原文 | 写入（存 payload） | **不写** |
| 内存指标（Counter/Histogram） | 累加 | 累加 |

---

## 数据库 Schema 设计

**核心设计决策**：Trace 汇总和 Span 明细**分表存储**。

单个 JSON 字段存 span 树的问题：

- "过去一周 `web_search` 工具的 P95 耗时" → 无法查询
- "所有包含 error span 的 trace" → 全表扫描解析 JSON
- "按工具名聚合失败率" → 不可行

拆成独立行后，这些都是普通 SQL `WHERE + GROUP BY`。

### Prisma Schema

```prisma
/// Trace 汇总表 —— 每条用户消息一行
model Trace {
  id              BigInt   @id @default(autoincrement())
  traceId         String   @unique
  accountId       String
  conversationId  String

  // 概况
  totalMs         Int                      // 端到端耗时
  llmRounds       Int                      // LLM 调用轮数
  toolCalls       Int                      // 工具调用次数
  inputTokens     Int                      // 输入 token 总计
  outputTokens    Int                      // 输出 token 总计
  stopReason      String                   // "stop" | "max_rounds" | "error"
  error           String?                  // 首个错误信息

  // 质量信号（确定性标记）
  flags           String   @default("")    // 逗号分隔: "error,max_rounds,slow,expensive"

  // 采样
  sampled         Boolean  @default(true)  // false = 仅汇总行，无 span 明细

  // 关联
  spans           TraceSpan[]

  createdAt       DateTime @default(now())

  @@index([accountId, createdAt(sort: Desc)])
  @@index([conversationId, createdAt(sort: Desc)])
  @@index([flags, createdAt(sort: Desc)])
  @@index([sampled, createdAt(sort: Desc)])
}

/// Span 明细表 —— 每个操作一行，仅采样命中的 trace 才写入
model TraceSpan {
  id              BigInt   @id @default(autoincrement())
  traceId         String
  spanId          String
  parentSpanId    String?                  // null = 根 span

  name            String                   // "llm.call" | "tool.execute" | ...
  startTime       DateTime                 // span 开始时间
  durationMs      Int                      // 耗时
  status          String                   // "ok" | "error"

  // 结构化属性（可直接 WHERE 查询）
  toolName        String?                  // tool.execute 时填充
  model           String?                  // llm.call 时填充
  inputTokens     Int?                     // llm.call 时填充
  outputTokens    Int?                     // llm.call 时填充
  stopReason      String?                  // llm.call 时填充
  errorMessage    String?                  // status=error 时填充

  // 大字段：prompt/completion 原文（仅 llm.call 类型、仅采样命中时）
  payload         String?                  // JSON 字符串，已脱敏

  trace           Trace    @relation(fields: [traceId], references: [traceId])

  @@index([traceId])
  @@index([name, startTime(sort: Desc)])
  @@index([toolName, status])
  @@index([status, startTime(sort: Desc)])
}
```

### 查询能力对比

| 查询需求 | 旧方案（JSON 字段） | 新方案（分表） |
| -------- | -------------------- | -------------- |
| web_search 工具 P95 耗时 | 全表扫 JSON 解析 | `SELECT percentile(durationMs) FROM TraceSpan WHERE toolName='web_search'` |
| 包含 error span 的 trace | 全表扫 JSON 解析 | `SELECT DISTINCT traceId FROM TraceSpan WHERE status='error'` |
| 按工具名聚合失败率 | 不可行 | `GROUP BY toolName, status` |
| 某条 trace 的完整 span 树 | 直接读 JSON | `WHERE traceId = ? ORDER BY startTime` |
| 某次 LLM 调用的 prompt 原文 | 需解析 JSON 再定位 | `WHERE traceId = ? AND name='llm.call'` 读 payload |

---

## 实现方案

### 消息流与埋点位置

```text
WeChat 消息到达
  │
  ↓
processOneMessage()
  │  ← runWithTrace(accountId, conversationId, async () => {
  │       // 以下所有代码自动在 trace 上下文中
  ↓
Agent.chat(req)
  │  ← withSpan("command.dispatch", ...)
  ├── 命中命令 → execute(ctx) → 返回
  │
  └── 未命中 → withConversationLock()
        │  ← withSpan("conversation.lock", ...)
        ↓
      chat(ai.ts)
        │  ← withSpan("agent.chat", ...)
        ├── ensureHistoryLoaded()  ← withSpan("history.load", ...)
        ↓
      AgentRunner loop
        ├── Round 1
        │   ├── LLM call           ← withSpan("llm.call", {model, tokens...})
        │   ├── Tool: web_search   ← withSpan("tool.execute", {toolName...})
        │   └── Tool: calculator   ← withSpan("tool.execute", {toolName...})
        │                            ↑ 并行分支，各自独立 span，共享 parent
        ├── Round 2
        │   └── LLM call           ← withSpan("llm.call", {model, tokens...})
        ↓
      finalizeReply()
        ↓
      sendMessageWeixin()          ← withSpan("message.send", ...)
  │
  │  }) ← runWithTrace 结束
  ↓
  [采样判定 → Trace 汇总落库 → 命中则 Span 明细落库]
```

### 埋点示例

#### 入口：agent.ts

```typescript
import { runWithTrace, withSpan, getActiveTrace } from "./trace.js";
import { queuePersistTrace } from "./db/traces.js";

// Agent.chat() 方法内
async chat(req: ChatRequest): Promise<ChatResponse> {
  return runWithTrace(accountId, req.conversationId, async () => {
    // 内置命令拦截
    const dispatched = withSpanSync("command.dispatch", {}, () =>
      commandRegistry.tryDispatch(req.text),
    );
    if (dispatched) {
      // ...
    }

    // 正常 LLM 流程
    return withSpan("conversation.lock", {}, () =>
      withConversationLock(accountId, req.conversationId, async () => {
        const reply = await chat(accountId, req.conversationId, /* ... */);

        // trace 结束，非阻塞入队（不 await）
        const trace = getActiveTrace()!;
        const summary = trace.summarize();
        queuePersistTrace(summary, trace.getSpans());

        return reply;
      }),
    );
  });
}
```

#### runner.ts：工具调用（不需要传 trace 参数）

```typescript
import { withSpan } from "../trace.js";

// 工具执行处
const toolResults = await Promise.all(
  toolCalls.map((toolCall) =>
    withSpan(
      "tool.execute",
      { toolName: toolCall.name },
      async () => {
        const content = await tools.execute(
          toolCall.name,
          toolCall.arguments,
          createToolContext(signal, timeoutMs),
        );
        return buildToolResult(toolCall.id, toolCall.name, content, false);
      },
    ).catch((error) =>
      // withSpan 已自动记录 error span
      buildToolResult(toolCall.id, toolCall.name, [/* ... */], true),
    ),
  ),
);
```

#### runner.ts：LLM 调用（记录 prompt/completion）

```typescript
import { withSpan } from "../trace.js";

// 每轮 LLM 调用
const response = await withSpan(
  "llm.call",
  { model: modelId, round },
  async () => {
    const resp = await model.chat(messages);
    // attributes 在 span 结束时已记录，prompt/completion 需额外处理
    return resp;
  },
);

// prompt/completion 记录（在 onMessage 回调中）
// 由采样策略决定是否写入 payload 字段
```

### 落库逻辑：异步缓冲 + 批量写入

**设计原则**：复用项目现有的消息队列模式（`queuePersistMessage`），但针对 trace 数据做批量优化。

**为什么不直接 `await persistTrace()`**：

- 高并发下，每次请求写 1 条 Trace + 10 条 Span，数据库成为瓶颈
- 批量写入（`createMany`）性能远高于逐条写入：一次写 100 条 vs 分 100 次各写 1 条

**实现方案**：

```typescript
// packages/server/src/db/traces.ts

import { shouldPersistTrace, type SamplingConfig } from "./sampling.js";
import { getPrisma } from "./prisma.js";
import type { SpanData, TraceContext } from "../trace.js";

const defaultSampling: SamplingConfig = {
  normalRate: 0.1,
  forceRetain: {
    hasError: true,
    hitMaxRounds: true,
    totalMsThreshold: 30_000,
    totalTokensThreshold: 50_000,
  },
};

// ============================================================
// 1. 队列数据结构
// ============================================================

interface TraceQueueItem {
  summary: ReturnType<TraceContext["summarize"]>;
  spans: SpanData[];
  sampled: boolean;
  attempts: number;
}

const traceQueue: TraceQueueItem[] = [];
let flushing = false;
let flushTimer: NodeJS.Timeout | null = null;

// ============================================================
// 2. 入队：非阻塞，立即返回
// ============================================================

export function queuePersistTrace(
  summary: ReturnType<TraceContext["summarize"]>,
  spans: SpanData[],
): void {
  const sampled = shouldPersistTrace(summary, defaultSampling);
  traceQueue.push({ summary, spans, sampled, attempts: 0 });

  // 达到批量阈值或定时触发 flush
  if (traceQueue.length >= 50) {
    void flushTraceQueue();
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushTraceQueue();
    }, 2_000);  // 2 秒内没达到 50 条也触发
    flushTimer.unref?.();
  }
}

// ============================================================
// 3. 批量写入：createMany 一次性写入
// ============================================================

async function flushTraceQueue(): Promise<void> {
  if (flushing || traceQueue.length === 0) return;
  flushing = true;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  // 取出当前队列的所有项（避免写入过程中新增的项被重复处理）
  const batch = traceQueue.splice(0, traceQueue.length);

  try {
    const prisma = getPrisma();

    // 批量写入 Trace 汇总行
    await prisma.trace.createMany({
      data: batch.map((item) => ({
        traceId: item.summary.traceId,
        accountId: item.summary.accountId,
        conversationId: item.summary.conversationId,
        totalMs: item.summary.totalMs,
        llmRounds: item.summary.llmRounds,
        toolCalls: item.summary.toolCalls,
        inputTokens: item.summary.inputTokens,
        outputTokens: item.summary.outputTokens,
        stopReason: String(item.summary.stopReason),
        error: item.summary.error,
        flags: buildFlags(item.summary).join(","),
        sampled: item.sampled,
      })),
      skipDuplicates: true,  // 防止重试时重复写入
    });

    // 批量写入 TraceSpan 明细行（仅采样命中的）
    const allSpans = batch
      .filter((item) => item.sampled && item.spans.length > 0)
      .flatMap((item) =>
        item.spans.map((s) => ({
          traceId: item.summary.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId,
          name: s.name,
          startTime: new Date(s.startTime),
          durationMs: s.duration,
          status: s.status,
          toolName: (s.attributes.toolName as string) ?? null,
          model: (s.attributes.model as string) ?? null,
          inputTokens: (s.attributes.inputTokens as number) ?? null,
          outputTokens: (s.attributes.outputTokens as number) ?? null,
          stopReason: (s.attributes.stopReason as string) ?? null,
          errorMessage: (s.attributes.error as string) ?? null,
          payload: s.attributes.promptSnapshot
            ? JSON.stringify({
                prompt: s.attributes.promptSnapshot,
                completion: s.attributes.completionSnapshot,
              })
            : null,
        })),
      );

    if (allSpans.length > 0) {
      await prisma.traceSpan.createMany({
        data: allSpans,
        skipDuplicates: true,
      });
    }
  } catch (error) {
    // 写入失败，重新入队并指数退避
    for (const item of batch) {
      item.attempts += 1;
      if (item.attempts <= 3) {
        traceQueue.push(item);
      } else {
        console.error(
          `[trace] 放弃写入 ${item.summary.traceId}（重试 ${item.attempts} 次失败）`,
          error,
        );
      }
    }

    const backoffMs = Math.min(10_000, 1_000 * 2 ** Math.min(batch[0]?.attempts ?? 1, 4));
    setTimeout(() => void flushTraceQueue(), backoffMs);
  } finally {
    flushing = false;
  }
}

function buildFlags(summary: ReturnType<TraceContext["summarize"]>): string[] {
  const flags: string[] = [];
  if (summary.hasError) flags.push("error");
  if (summary.stopReason === "max_rounds") flags.push("max_rounds");
  if (summary.totalMs > 30_000) flags.push("slow");
  if (summary.inputTokens + summary.outputTokens > 50_000) flags.push("expensive");
  return flags;
}
```

---

## 可视化看板

### 看板 1：实时概览

```text
+-------------------------------------------------------------+
|  Agent Observability Dashboard                    [24h v]    |
+----------+----------+----------+----------+-----------------+
| 请求总量  | 平均耗时  | 错误率    | 日 Token  | 日估算费用     |
|  1,247   |  3.2s    |  0.8%    | 2.1M     | $ 48.6         |
+----------+----------+----------+----------+-----------------+
|                                                              |
|  请求耗时分布 (P50 / P95 / P99)                                |
|  ▁▂▃▅▇▅▃▂▁▁  1.8s / 6.2s / 12.4s                            |
|                                                              |
+--------------------------------------------------------------+
|                                                              |
|  LLM 轮数分布                    工具调用 Top 5               |
|  1轮 ████████████ 68%           web_search    ████ 42%      |
|  2轮 █████ 22%                  get_weather   ███  28%      |
|  3轮 ██ 7%                      send_file     ██   15%      |
|  4+ █ 3%                        calculator    █    8%       |
|                                 code_exec     █    7%       |
+--------------------------------------------------------------+
```

### 看板 2：Trace 详情（排查用）

```text
+--------------------------------------------------------------+
|  Trace: a3f8c2d1-...                          2024-01-15     |
|  Account: ...x8f2a1  Conv: ...group_001                      |
|  Total: 4,218ms  Rounds: 2  Tools: 2  Status: OK             |
|  Flags: (none)                                                |
+--------------------------------------------------------------+
|                                                               |
|  Timeline (span 树自动构建，缩进 = 父子关系)                    |
|  |- message.receive     |##|                           42ms   |
|  |- agent.chat                                                |
|  |  |- history.load     |###|                          86ms   |
|  |  |- llm.call (R1)    |###############|          2,340ms    |
|  |  |  tokens: 1200->340  stop: toolUse                       |
|  |  |  [View Prompt] [View Completion]   <- 点击展开原文       |
|  |  |- tool.web_search  |######|                     890ms    |
|  |  |- tool.get_weather  |##|                        120ms    |
|  |  |- llm.call (R2)    |######|                     680ms    |
|  |     tokens: 2100->580  stop: stop                          |
|  |     [View Prompt] [View Completion]                        |
|  |- message.send        |#|                            60ms   |
|                                                               |
+--------------------------------------------------------------+
```

---

## 落地路径

| 阶段 | 任务 | 投入 | 价值 |
| ---- | ---- | ---- | ---- |
| **P0 — AsyncLocalStorage 上下文** | `trace.ts` 模块：`runWithTrace` / `withSpan` / `getTraceId` | 1 天 | 全链路可追踪的基础设施，一次投入永久受益 |
| **P0 — 工具/LLM 计时** | runner.ts 用 `withSpan` 包裹工具和 LLM 调用 | 半天 | 知道慢在哪 |
| **P1 — 分表落库** | Prisma Trace + TraceSpan 表 + 异步写入 | 1 天 | 明细可查询，不是 JSON 黑盒 |
| **P1 — 采样策略** | 异常强制保留 + 正常 10% 采样 | 半天 | 存储成本可控 |
| **P1 — Prompt/Completion 记录** | LLM span 写入脱敏后的 prompt/completion | 1 天 | 排查 Agent 行为问题的核心数据 |
| **P2 — 日志自动注入 traceId** | logger.ts 读 AsyncLocalStorage | 半天 | 日志和 trace 关联，零改动成本 |
| **P2 — 指标端点** | `/api/metrics` + 内存聚合 | 2 天 | 系统健康一目了然 |
| **P2 — 异常标记** | flags 字段：error / max_rounds / slow / expensive | 半天 | 主动发现问题 |
| **P3 — Web 看板** | 控制台 Trace 列表 + Timeline 详情页 | 3-5 天 | 完整调试体验 |
| **P3 — 数据清理** | 定时任务清理过期 TraceSpan（正常 7 天，异常 30 天） | 半天 | 存储不会无限增长 |

---

## 设计决策

| 决策 | 选择 | 备选 | 选择理由 |
| ---- | ---- | ---- | -------- |
| 上下文传递 | AsyncLocalStorage 隐式传播 | 显式参数传递 | 调用链深度不确定，显式传参必然烂尾 |
| Span 父子关系 | AsyncLocalStorage 自动维护 span 栈 | 手动传 parentSpanId | 多层嵌套 + 并行分支下手动维护不可行 |
| 存储结构 | Trace 汇总表 + TraceSpan 明细表 | 单表 JSON 字段 | 工具耗时、失败率等查询需要结构化字段 |
| 采样时机 | Trace 结束后决定 | Trace 开始时（head-based） | 开始时不知道会不会出错，提前丢弃会错过异常 |
| 采样策略 | 异常 100% + 正常按比例 | 全量保留 | 存储成本随流量线性增长不可持续 |
| Prompt/Completion | 异常必记 + 采样命中记 + 脱敏 + 独立字段 | 不记录 / 全量记录 | 排查核心数据，但需控制大小和隐私 |
| 质量信号 | 仅确定性指标（error/max_rounds/slow） | 加用户行为推断 | 模糊推断误报率高，初期投入产出比低 |
| Trace 粒度 | 一条用户消息 = 一个 Trace | 一个会话 = 一个 Trace | Agent 处理是完整事务，按消息粒度排查最直观 |
| 落库方式 | 异步队列 | 同步写入 | 不阻塞主流程，复用现有 message 队列模式 |
| Token 来源 | LLM API 响应中的 usage 字段 | tiktoken 估算 | API 返回值最准确，零额外依赖 |
| traceId 格式 | UUID v4 | ULID / 自增 | 简单、无冲突、无需协调，Node.js 原生支持 |
