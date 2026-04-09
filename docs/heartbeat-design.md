# Heartbeat（内部节拍器）设计方案

## 概述

Heartbeat 是 Agent 的**内驱力机制**：当没有用户消息、也没有 cron 命中时，Agent 自己发现还有未完成的状态需要继续推进。

与 Scheduler 的核心区别：

| | Scheduler | Heartbeat |
|---|---|---|
| 谁创建 | 用户显式声明 | Agent 自己判断 |
| 触发条件 | cron 表达式命中 | `nextCheckAt <= now && status == pending` |
| 何时结束 | 用户删除 / 暂停 | 目标达成或放弃 |
| 执行频率 | 固定周期 | 动态退避（指数 backoff） |
| 本质 | 外部声明的计划（time-driven） | 内部推进的节拍器（state-driven） |

### 典型场景

1. **工具暂时不可用** — "上次调用失败了，冷却 5 分钟后重试"
2. **等待用户确认** — "用户说'我一会儿确认'，30 分钟后检查是否已回应"
3. **多步异步任务** — "这个目标还没完成，稍后再推进一步"
4. **对话中发现待跟进事项** — "用户确认了一半，还有未结事项"

### 在系统中的位置

```text
┌──────────────────────────────────────────────────────────────┐
│  User Message → Conversation Wake-up                         │
│  固定时间到了 → Scheduler Wake-up                             │
│  存在 pending state → Heartbeat Wake-up          ← 本方案     │
│                                                              │
│  三者共享同一套 Agent 能力，区别仅在触发方式                     │
└──────────────────────────────────────────────────────────────┘
```

### 前置依赖

> ✅ `chat()` — 已有对话能力（heartbeat **不直接调用**，见"内部推理通道"）
> ✅ `withConversationLock()` — 已有 per-conversation 锁
> ✅ `Tape Memory` — 已有事件溯源记忆系统
> ✅ `PushService` port — 已有主动推送能力
> ✅ `SchedulerStore` port 模式 — 可复用 port/impl 架构
> ✅ PostgreSQL + Prisma — 已有持久化层

## 核心问题：为什么不能直接建在 chat() 之上

现有 `chat()` 是一个"有真实对话副作用"的完整通道：

1. **写入消息历史** — 每次调用都会 `history.push()` + `messageStore.queuePersistMessage()`
2. **触发记忆抽取** — `fireExtractAndRecord()` 会把内部评估文本泄漏进 Tape Memory
3. **加载完整工具链** — runner 带 system prompt + always-on skills + 全部 tools
4. **无内置锁** — `chat()` 自身不加锁，locking 在 `server/src/agent.ts` 的调用侧

如果 heartbeat 直接调 `chat()`：
- 每次 tick 都会创建 `heartbeat:*` 伪会话，消息历史和记忆都被污染
- 轻量评估不轻量——200 tokens 的 eval prompt 会经过完整 runner pipeline
- 并发踩同一 account/conversation 的历史与 seq（数据竞争）
- 模型配置和会话记忆无法从原会话继承

**因此，本方案引入独立的"内部推理通道" `reasonInternal()`，与 `chat()` 并行存在。**

## 架构设计

### 整体流程

```text
┌──────────────────────────────────────────────────────────────┐
│                       Goal 来源                               │
│                                                              │
│  ① 对话中 Agent 主动挂起  create_pending_goal tool           │
│  ② 工具调用失败 → 系统自动创建 retry goal                     │
│  ③ 对话结束时 → 检测到未完成事项                               │
│                                                              │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│                    PendingGoal Store (DB)                     │
│  status / nextCheckAt / backoffMs / sourceConversationId     │
│  latestSourceMessageSeq / resumeSignal                       │
└──────────────┬───────────────────────────────────────────────┘
               │
     ┌─────────┴──────────┐
     │  Heartbeat Engine   │
     │  60s polling tick   │
     │  + immediate event  │
     └─────────┬──────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│              Evaluator (两阶段)                                │
│                                                              │
│  Phase 1: reasonInternal()                                   │
│     无消息持久化 / 无 memory extraction / 无 tools / 无 skills │
│     纯 LLM 判定 → 结构化 JSON                                │
│     → act / wait / resolve / abandon                         │
│                                                              │
│  Phase 2: 完整执行 (仅 verdict=act 时)                        │
│     通过 server 层 enqueue → withConversationLock → chat()    │
│     使用原始 conversationId，继承模型配置与记忆                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 模块划分

```text
packages/agent/src/heartbeat/
├── types.ts              # GoalStatus, PendingGoal, GoalTransition 类型
├── engine.ts             # Polling tick + event-driven trigger
├── evaluator.ts          # 两阶段评估（Phase 1 + Phase 2 调度）
├── reason-internal.ts    # 内部推理通道：无副作用 LLM 调用
├── tool.ts               # Agent Tool: create/resolve/list pending goals
└── index.ts              # 导出
```

放在 `packages/agent/src/heartbeat/` 而非独立包的理由（与 scheduler 相同）：
- heartbeat 是 agent 层的概念，不是 server 层
- 需要访问 `reasonInternal()`、model-resolver、tape recall
- Port 接口定义在 agent，实现注入由 server 完成

### 关键设计决策

#### 1. 内部推理通道 `reasonInternal()`

**这是本方案与上版方案最本质的区别。**

`reasonInternal()` 是一个受限的 LLM 调用通道：

```typescript
// packages/agent/src/heartbeat/reason-internal.ts

interface ReasonInternalOptions {
  accountId: string;
  /** 用于继承模型配置和 recall 记忆的源会话 */
  sourceConversationId: string;
  /** 系统级指令（不含 skills、不含 tools） */
  systemPrompt: string;
  /** 输入 prompt */
  userPrompt: string;
  /** 源会话增量消息的摘要（如果需要） */
  recentContext?: string;
}

interface ReasonInternalResult {
  text: string;
  usage: { input: number; output: number };
}
```

与 `chat()` 的区别：

| | `chat()` | `reasonInternal()` |
|---|---|---|
| 消息持久化 | ✅ 写入 history + DB | ❌ 不写 |
| Memory extraction | ✅ fire-and-forget 抽取 | ❌ 不触发 |
| Tools | ✅ 全部注册工具 | ❌ 无工具 |
| Skills | ✅ always-on + on-demand | ❌ 无技能 |
| Context window trim | ✅ 三级策略 | ❌ 单次短 prompt，无需 trim |
| Runner loop | ✅ 多轮（max 10） | ❌ 单轮 complete() |
| 模型配置 | ✅ resolveModel() | ✅ resolveModel()（继承源会话） |
| Tape memory | ✅ recall + compact | ✅ 只 recall（只读，不 compact） |
| Conversation lock | ❌ 自身不加锁 | ❌ 不需要（无共享状态写入） |

实现上直接调用底层 `complete()`，绕过 `runner.run()`：

```typescript
import { complete, type Model } from "@mariozechner/pi-ai";
import { resolveModel } from "../model-resolver.js";
import { recall, emptyState, formatMemoryForPrompt } from "../tape/index.js";

export async function reasonInternal(
  options: ReasonInternalOptions,
): Promise<ReasonInternalResult> {
  const { accountId, sourceConversationId, systemPrompt, userPrompt, recentContext } = options;

  // 继承源会话的模型配置
  const model = await resolveModel(accountId, sourceConversationId, "chat");

  // 只读 recall — 获取记忆上下文但不触发 compact
  const [sessionMemory, globalMemory] = await Promise.all([
    recall(accountId, sourceConversationId).catch(() => emptyState()),
    recall(accountId, "__global__").catch(() => emptyState()),
  ]);

  const memoryContext = formatMemoryForPrompt(globalMemory, sessionMemory);
  const now = new Date();
  const timePrefix = `[当前时间: ${now.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  })}]\n`;

  const parts = [timePrefix];
  if (memoryContext) parts.push(memoryContext + "\n");
  if (recentContext) parts.push(`[源会话近期消息]\n${recentContext}\n`);
  parts.push(userPrompt);

  const result = await complete(
    model.model,
    {
      systemPrompt,
      messages: [{
        role: "user" as const,
        content: [{ type: "text" as const, text: parts.join("") }],
        timestamp: Date.now(),
      }],
      tools: [],  // 无工具
    },
    model.apiKey ? { apiKey: model.apiKey } : {},
  );

  const text = result.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  return { text, usage: result.usage };
}
```

**成本：** Phase 1 的 `reasonInternal()` 只有一次简短的 `complete()` 调用——无 runner loop、无 tool execution、无 skill loading。输入大约 300-500 tokens（system prompt + context + 目标描述），输出约 50 tokens JSON。

#### 2. 两阶段评估（改进版）

**Phase 1: 结构化判定（`reasonInternal()` → JSON schema）**

不依赖 sentinel tag 或自由文本 JSON.parse，而是用严格的 output format + fallback：

```typescript
const EVAL_SYSTEM_PROMPT = `你是一个内部状态检查器，不是对话助手。
你只输出一个 JSON 对象，不输出其他任何内容。

JSON 格式（严格遵守）：
{"verdict":"act|wait|resolve|abandon","reason":"一句话"}

verdict 含义：
- act: 需要立即行动（调用工具、与用户交互）
- wait: 还不到时候，继续等
- resolve: 目标已达成
- abandon: 目标不再有意义

只输出 JSON。`;
```

解析时增加 fallback 策略：

```typescript
function parseEvalResult(text: string): { verdict: Verdict; reason: string } {
  // 1. 尝试直接 JSON.parse
  try {
    const parsed = JSON.parse(text.trim());
    if (isValidVerdict(parsed.verdict)) return parsed;
  } catch {}

  // 2. 尝试从 markdown code block 中提取
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isValidVerdict(parsed.verdict)) return parsed;
    } catch {}
  }

  // 3. 关键词 fallback（不是静默吞掉，而是记录异常）
  if (/完成|达成|resolved/i.test(text)) return { verdict: "resolve", reason: "keyword match" };
  if (/放弃|没有意义|abandon/i.test(text)) return { verdict: "abandon", reason: "keyword match" };
  if (/执行|行动|需要|act/i.test(text)) return { verdict: "act", reason: "keyword match" };

  // 4. 默认 wait + 记录 warning
  console.warn(`[heartbeat] eval parse failed, defaulting to wait. raw: ${text.slice(0, 200)}`);
  return { verdict: "wait", reason: "parse_failed" };
}
```

**Phase 2: 完整执行（通过 ExecutionPort 回到 server 层）**

Phase 2 **不再自己调 `chat()`**，而是通过 Port 请求 server 层在正确的锁保护下执行：

```typescript
// packages/agent/src/ports/heartbeat-executor.ts

export interface HeartbeatExecutionRequest {
  accountId: string;
  conversationId: string;  // 原始会话 ID，不是隔离 ID
  prompt: string;           // 注入到原会话中的执行 prompt
}

export interface HeartbeatExecutionResult {
  text?: string;
  status: "completed" | "error";
  error?: string;
}

export interface HeartbeatExecutorPort {
  /**
   * 请求在原始会话中执行一次 chat()。
   * 实现方需保证 withConversationLock() 包裹。
   * 执行结果会正常写入对话历史（这是有意的——Phase 2 是真正的行动）。
   */
  execute(req: HeartbeatExecutionRequest): Promise<HeartbeatExecutionResult>;
}
```

server 层实现：

```typescript
// server 侧注入
const heartbeatExecutor: HeartbeatExecutorPort = {
  async execute(req) {
    return withConversationLock(req.accountId, req.conversationId, async () => {
      try {
        const result = await chat(req.accountId, req.conversationId, req.prompt);
        return { text: result.text, status: "completed" };
      } catch (err) {
        return { status: "error", error: (err as Error).message };
      }
    });
  },
};
```

**为什么 Phase 2 用原始 conversationId：**

- 继承模型配置（`resolveModel()` 按 conversationId 查）
- 继承会话记忆（`recall(accountId, conversationId)`）
- 用户能在原会话中看到 Agent 的行动结果（不是来自一个莫名的内部分支）
- 推送结果时有完整上下文，不需要额外解释

**为什么 Phase 2 显式通过 ExecutorPort：**

- heartbeat 是 agent 层模块，没有资格直接拿到 server 层的锁
- Port 模式让 agent 层定义接口、server 层提供实现，与 PushService / SchedulerStore 保持一致
- server 层实现内部自然包含 `withConversationLock()`，不需要 heartbeat 自己管锁

#### 3. Polling Tick + Event-Driven Trigger（保留）

上版方案的 polling + immediate trigger 组合是对的：

```text
┌──────────────────────────┐
│  setInterval(60s)        │─── 每分钟巡检一次 ──→ 查询 due goals
│  60s 精度对 heartbeat 够用│
└──────────────────────────┘

┌──────────────────────────┐
│  goalEvent(goalId, type) │─── 事件驱动 ──→ 立即处理特定 goal
│  user_replied / created  │
└──────────────────────────┘
```

但不直接 `triggerHeartbeat()` 执行，而是写事件到 goal store，让 engine 消费（见下文"waiting_user 恢复"）。

#### 4. waiting_user 的正确恢复链

**上版问题：** heartbeat 在 `heartbeat:{goalId}` 执行，看不到用户在原会话回复了什么。`checkWaitingGoals()` hook 在消息写入前触发。

**改进方案：** 用 `resumeSignal` + `latestSourceMessageSeq` 做异步事件传递，不在 inbound hook 里立即执行。

```text
时间线：

T1  用户发消息 → server/agent.ts inbound
T2  消息写入历史 (seq=42)
T3  chat() 完成
T4  post-chat hook: 检查 waiting_user goals
    → 找到匹配的 goal
    → store.markUserReplied(goalId, { latestSourceMessageSeq: 42, resumeSignal: "user_replied" })
    → goal.status 仍为 waiting_user，但 resumeSignal 已写入
T5  下次 tick（或 immediate event）
    → engine 发现 goal 有 resumeSignal
    → evaluator Phase 1: reasonInternal() 带上源会话增量消息
       （从 goal.latestSourceMessageSeq 之后读取）
    → 能看到用户回复了什么
    → 判断 act / wait / resolve
```

关键改进：
- **不在 inbound hook 里立即 triggerHeartbeat()**——只写事件
- **evaluator 消费增量消息**——通过 `latestSourceMessageSeq` 定位，读取源会话中的新消息
- **resumeSignal 是队列，不是触发器**——engine 在自己的 tick 中消费

读取源会话增量消息的实现：

```typescript
async function getRecentContextSince(
  accountId: string,
  conversationId: string,
  sinceSeq: number,
  maxMessages: number = 10,
): Promise<string> {
  const messageStore = getMessageStore();
  const recent = await messageStore.getMessagesSince(accountId, conversationId, sinceSeq, maxMessages);
  
  if (recent.length === 0) return "";
  
  return recent.map(msg => {
    if (msg.role === "user") return `用户: ${extractTextContent(msg)}`;
    if (msg.role === "assistant") return `助手: ${extractTextContent(msg)}`;
    return "";
  }).filter(Boolean).join("\n");
}
```

> 需要在 `MessageStore` port 上新增 `getMessagesSince(accountId, conversationId, sinceSeq, limit)` 方法。

#### 5. Push 作为可选 Side Effect

**上版问题：** push 直接耦合在 evaluator 里，且推送的提醒消息不会持久化到对话历史。

**改进方案：** heartbeat 的核心输出是 **GoalTransition**，push 由独立的 effect handler 消费。

```typescript
// evaluator 的返回不是"直接 push"，而是状态转移
interface GoalTransition {
  goalId: string;
  newStatus: GoalStatus;
  updates: Partial<PendingGoalUpdate>;
  /** 可选：请求向用户推送消息（evaluator 不直接推） */
  requestPush?: {
    conversationId: string;
    text: string;
  };
  /** 可选：请求在原会话执行 Phase 2 */
  requestExecution?: HeartbeatExecutionRequest;
}
```

engine 消费 transition：

```typescript
async function applyTransition(transition: GoalTransition): Promise<void> {
  const store = getHeartbeatStore();
  
  // 1. 写状态
  await store.updateGoal(transition.goalId, transition.updates);
  
  // 2. Phase 2 执行（如果需要）
  if (transition.requestExecution) {
    const executor = getHeartbeatExecutor();
    const result = await executor.execute(transition.requestExecution);
    // 根据执行结果再次更新 goal 状态...
  }
  
  // 3. 推送（如果需要且可用）
  if (transition.requestPush) {
    try {
      const push = getPushService();
      await push.sendProactiveMessage(
        transition.requestPush.accountId,
        transition.requestPush.conversationId,
        transition.requestPush.text,
      );
    } catch {
      // push 失败不影响 goal 状态
      // goal resolved 不依赖 push 成功
    }
  }
}
```

**goal resolved 的判定完全基于内部状态，不依赖 push 是否成功。**

#### 6. 并发控制和锁

**三层保护：**

```text
Layer 1: inflight Set  — 同一 goal 不重入（engine 层）
Layer 2: per-account serial queue — 同一 account 的 heartbeat 串行执行（engine 层）
Layer 3: withConversationLock — Phase 2 执行时的对话锁（server 层，通过 Port）
```

Layer 1 和 Layer 2 在 engine 内实现：

```typescript
// engine.ts

const inflight = new Set<string>();

/** 每个 account 一个串行队列，避免同一人的多个 goal 并发消耗 token */
const accountQueues = new Map<string, Promise<void>>();

function enqueueForAccount(accountId: string, fn: () => Promise<void>): void {
  const current = accountQueues.get(accountId) ?? Promise.resolve();
  const next = current.then(fn).catch(err => {
    console.error(`[heartbeat] account ${accountId} queue error:`, err);
  });
  accountQueues.set(accountId, next);
}

async function tick(): Promise<void> {
  const store = getHeartbeatStore();
  const now = new Date();

  // 1. 过期清理
  await store.abandonExpired(now);

  // 2. 处理 resumeSignal（waiting_user → pending）
  await store.processResumeSignals(now);

  // 3. 拉取到期 goals
  const dueGoals = await store.findDueGoals(now);

  for (const goal of dueGoals) {
    if (inflight.has(goal.goalId)) continue;

    inflight.add(goal.goalId);
    enqueueForAccount(goal.accountId, async () => {
      try {
        await evaluateGoal(goal);
      } finally {
        inflight.delete(goal.goalId);
      }
    });
  }
}
```

Layer 3 由 Phase 2 的 `HeartbeatExecutorPort` 实现保证——server 层在 `execute()` 内部调用 `withConversationLock()`。

#### 7. 递归保护：goal 不能生成 goal

**上版问题：** Phase 2 是完整 `chat()`，runner 带所有工具包括 `create_pending_goal`。一次 heartbeat 执行可能再创建新 goal，形成树状膨胀。

**改进方案：**

```typescript
// heartbeat/tool.ts — create_pending_goal 的执行逻辑

async function handleCreatePendingGoal(params: CreateGoalParams): Promise<string> {
  const store = getHeartbeatStore();

  // ── 硬保护 ──

  // 1. per-account 配额
  const activeCount = await store.countActiveGoals(params.accountId);
  if (activeCount >= LIMITS.maxActiveGoalsPerAccount) {
    return `拒绝：当前已有 ${activeCount} 个活跃目标（上限 ${LIMITS.maxActiveGoalsPerAccount}）。请先完成现有目标。`;
  }

  // 2. 阻断递归：如果当前执行上下文是 heartbeat，禁止创建新 goal
  if (isHeartbeatContext()) {
    return "拒绝：heartbeat 执行中不能创建新的 pending goal。请在结论中说明需要后续跟进的事项。";
  }

  // 3. 同源去重：同一 conversationId + 相似 description 的 goal 只保留一个
  const existing = await store.findSimilarGoal(params.accountId, params.conversationId, params.description);
  if (existing) {
    return `已存在相似目标: ${existing.goalId}（${existing.description}）。不重复创建。`;
  }

  // ... 正常创建
}
```

`isHeartbeatContext()` 通过 Phase 2 执行时注入的上下文标记实现：

```typescript
// 执行 Phase 2 时，在 prompt 前注入标记
const phase2Prompt = `[执行上下文: heartbeat/phase2, 目标: ${goal.goalId}]
[限制: 本次执行中不能创建新的 pending goal]

${goal.description}

${contextSummary}`;
```

同时在 tool 注册时，Phase 2 的 chat 调用可以通过 `setHeartbeatContext(true)` 设置标记。

## 数据模型

### PendingGoal

| 字段 | 类型 | 说明 |
|---|---|---|
| id | BigInt | 主键 |
| goalId | UUID | 外部标识 |
| accountId | String | 所属账号 |
| sourceConversationId | String | 源会话 ID（继承模型配置、记忆、推送目标） |
| description | String | 目标描述 |
| context | Text | 创建时的上下文快照 |
| originType | String | `conversation` / `tool_failure` / `follow_up` |
| originRef | String? | 关联的消息 seq / 工具调用 ID |
| status | String | `pending` / `checking` / `waiting_user` / `resolved` / `abandoned` |
| nextCheckAt | DateTime | 下次评估时间 |
| checkCount | Int | 已检查次数 |
| maxChecks | Int | 上限（默认 10） |
| backoffMs | Int | 当前退避间隔（初始 5 分钟） |
| latestSourceMessageSeq | Int? | 源会话中已知的最新消息 seq（读取增量用） |
| resumeSignal | String? | 事件信号：`user_replied` / `manual_trigger` / null |
| lastCheckAt | DateTime? | 上次检查时间 |
| lastCheckResult | Text? | 上次检查摘要 |
| resolution | Text? | 最终结论 |
| totalInputTokens | Int | 累计消耗 input tokens |
| totalOutputTokens | Int | 累计消耗 output tokens |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |
| expiresAt | DateTime? | 硬截止 — 过期直接 abandon |

### Prisma Schema

```prisma
model PendingGoal {
  id                      BigInt    @id @default(autoincrement())
  goalId                  String    @unique @default(uuid())
  accountId               String
  sourceConversationId    String

  description             String
  context                 String    @db.Text
  originType              String    // 'conversation' | 'tool_failure' | 'follow_up'
  originRef               String?

  status                  String    @default("pending")

  nextCheckAt             DateTime
  checkCount              Int       @default(0)
  maxChecks               Int       @default(10)
  backoffMs               Int       @default(300000)  // 5 min

  latestSourceMessageSeq  Int?
  resumeSignal            String?

  lastCheckAt             DateTime?
  lastCheckResult         String?   @db.Text
  resolution              String?   @db.Text

  totalInputTokens        Int       @default(0)
  totalOutputTokens       Int       @default(0)

  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt
  expiresAt               DateTime?

  @@index([status, nextCheckAt])
  @@index([accountId, status])
  @@index([accountId, sourceConversationId, status])
}
```

**与上版方案的区别：**

- `conversationId` → `sourceConversationId`：语义更准确，这不是执行上下文，是来源
- 新增 `latestSourceMessageSeq`：支持增量读取源会话消息
- 新增 `resumeSignal`：事件驱动恢复，取代 inbound hook 里的直接触发
- 新增 `totalInputTokens` / `totalOutputTokens`：token 预算追踪（从 `reasonInternal()` 返回值累计）
- 移除了上版的 `context` 作为唯一上下文来源——现在可以通过 `latestSourceMessageSeq` 读取活的上下文

## 状态机

```text
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
 [创建] ──→ pending ──→ checking ──→ pending      │
                │          │           (backoff)  │
                │          │                      │
                │          ├──→ waiting_user ──────┘
                │          │      (resumeSignal → pending)
                │          │
                │          ├──→ resolved   [终态]
                │          │
                │          └──→ abandoned  [终态]
                │
                └──→ abandoned  (expiresAt / maxChecks)
```

状态转移规则：

| 当前状态 | 事件 | 新状态 | 条件 |
|---|---|---|---|
| pending | tick 到期 | checking | `nextCheckAt <= now` |
| checking | Phase 1 = resolve | resolved | — |
| checking | Phase 1 = abandon | abandoned | — |
| checking | Phase 1 = wait | pending | `nextCheckAt += backoff` |
| checking | Phase 1 = act → Phase 2 完成 | resolved | — |
| checking | Phase 1 = act → Phase 2 仍需跟进 | pending | `nextCheckAt += backoff` |
| checking | Phase 1 = act → Phase 2 需要用户 | waiting_user | — |
| checking | 异常 | pending | backoff + checkCount++ |
| waiting_user | 用户在源会话回复 | pending | `resumeSignal = "user_replied"`, backoff 重置 |
| any active | expiresAt 过期 | abandoned | — |
| any active | checkCount >= maxChecks | abandoned | — |

### 退避策略

```text
Check 1:    5 min
Check 2:   15 min   (×3)
Check 3:   45 min   (×3)
Check 4:    2 hours  (×3, capped)
Check 5:    2 hours
...
Check 10:   2 hours  → abandoned
```

```typescript
const INITIAL_BACKOFF_MS = 5 * 60 * 1000;   // 5 min
const MAX_BACKOFF_MS = 2 * 60 * 60 * 1000;  // 2 hours
const BACKOFF_MULTIPLIER = 3;

function nextBackoff(current: number): number {
  return Math.min(current * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
}
```

## Port 接口

### HeartbeatStore

```typescript
// packages/agent/src/ports/heartbeat-store.ts

export interface HeartbeatStore {
  // ── CRUD ──
  createGoal(input: CreateGoalInput): Promise<PendingGoalRow>;
  getByGoalId(goalId: string): Promise<PendingGoalRow | null>;
  updateGoal(goalId: string, updates: UpdateGoalInput): Promise<void>;

  // ── 查询 ──
  findDueGoals(now: Date): Promise<PendingGoalRow[]>;
  findByAccountAndStatus(accountId: string, conversationId: string, status: GoalStatus): Promise<PendingGoalRow[]>;
  countActiveGoals(accountId: string): Promise<number>;
  findSimilarGoal(accountId: string, conversationId: string, description: string): Promise<PendingGoalRow | null>;
  listGoals(accountId: string, includeTerminal?: boolean): Promise<PendingGoalRow[]>;

  // ── 事件 ──
  markUserReplied(goalId: string, messageSeq: number): Promise<void>;
  processResumeSignals(now: Date): Promise<number>;

  // ── 生命周期 ──
  abandonExpired(now: Date): Promise<number>;
}
```

### HeartbeatExecutorPort

```typescript
// packages/agent/src/ports/heartbeat-executor.ts

export interface HeartbeatExecutorPort {
  execute(req: HeartbeatExecutionRequest): Promise<HeartbeatExecutionResult>;
}
```

### MessageStore 扩展

```typescript
// 在现有 MessageStore 增加一个方法
export interface MessageStore {
  // ... 现有方法 ...

  /** 读取 conversationId 中 seq > sinceSeq 的消息（最多 limit 条） */
  getMessagesSince(
    accountId: string,
    conversationId: string,
    sinceSeq: number,
    limit: number,
  ): Promise<Array<{ seq: number; role: string; textContent: string }>>;
}
```

## 资源保护

### 硬限制

```typescript
const LIMITS = {
  /** 单账号最多活跃 goal 数 */
  maxActiveGoalsPerAccount: 5,
  
  /** 全局同时评估的 goal 数 */
  maxConcurrentChecks: 3,
  
  /** 单 goal 最大检查次数 */
  defaultMaxChecks: 10,
  
  /** 单 goal 最大存活时间 */
  goalHardExpiryMs: 7 * 24 * 3600_000,  // 7 天
  
  /** 单 goal 累计 token 预算 */
  maxTokensPerGoal: 20_000,
  
  /** 单账号每小时 heartbeat token 预算（通过 goal 的 totalTokens 统计） */
  maxTokensPerHourPerAccount: 50_000,
  
  /** Phase 2 执行中禁止创建新 goal */
  allowNestedGoalCreation: false,
};
```

Token 追踪不依赖 `ChatResponse`（上版问题），而是由 `reasonInternal()` 直接返回 `usage`：

```typescript
// Phase 1 执行后
const evalResult = await reasonInternal({ ... });
await store.updateGoal(goal.goalId, {
  totalInputTokens: goal.totalInputTokens + evalResult.usage.input,
  totalOutputTokens: goal.totalOutputTokens + evalResult.usage.output,
});

// 检查预算
if (goal.totalInputTokens + goal.totalOutputTokens > LIMITS.maxTokensPerGoal) {
  await store.updateGoal(goal.goalId, { status: "abandoned", resolution: "token budget exceeded" });
  return;
}
```

### per-account 串行队列

同一 account 的多个 goal 串行评估（engine 层实现），原因：
- 避免同一人的多个 heartbeat 并发消耗 token
- 同一人的 heartbeat 可能涉及相关上下文，串行避免竞争
- 不同 account 之间完全并行

## 集成点

### 1. server/agent.ts — post-chat hook

```typescript
// 在现有 chat 完成后（T3），异步检查 waiting_user goals
const reply = await withConversationLock(accountId, effectiveConvId, async () =>
  chat(accountId, effectiveConvId, req.text, req.media, startedAt),
);

// post-chat: 异步检查 waiting goals（不阻塞回复）
checkWaitingGoalsAsync(accountId, effectiveConvId).catch(err =>
  console.warn("[heartbeat] checkWaitingGoals failed:", err),
);
```

```typescript
async function checkWaitingGoalsAsync(accountId: string, conversationId: string): Promise<void> {
  const store = getHeartbeatStore();
  const waiting = await store.findByAccountAndStatus(accountId, conversationId, "waiting_user");
  
  if (waiting.length === 0) return;
  
  // 获取当前最新 seq
  const latestSeq = getCurrentSeq(accountId, conversationId);
  
  for (const goal of waiting) {
    // 只写事件，不立即执行
    await store.markUserReplied(goal.goalId, latestSeq);
  }
}
```

### 2. scheduler/executor.ts — 工具失败自动创建 goal

```typescript
// 可选集成：scheduler 任务执行失败时自动创建 retry goal
if (status === "error" && !shouldPause) {
  const heartbeatStore = getHeartbeatStore();
  await heartbeatStore.createGoal({
    accountId: task.accountId,
    sourceConversationId: task.conversationId,
    description: `重试定时任务 #${task.seq}「${task.name}」`,
    context: `上次错误: ${error}`,
    originType: "tool_failure",
    originRef: `scheduler:${task.seq}`,
    delayMs: 5 * 60_000,
    maxChecks: 3,
  });
}
```

### 3. server/runtime.ts — 启动 / 关闭

```typescript
// bootstrap 时
await schedulerManager.bootstrap();
startHeartbeat();  // 新增

// shutdown 时
stopHeartbeat();   // 新增
await schedulerManager.shutdown();
```

### 4. Agent Tool 注册

```typescript
// create_pending_goal 注册到 ToolRegistry
// 在 heartbeat/tool.ts 中定义，在 server 层注册
toolRegistry.register([
  createPendingGoalTool,
  resolvePendingGoalTool,
  listPendingGoalsTool,
]);
```

## 与上版方案的对比

| 问题 | 上版 | 本版 |
|---|---|---|
| P0: chat() 副作用 | 直接调 chat() | Phase 1 用 reasonInternal()，Phase 2 通过 ExecutorPort |
| P0: waiting_user 断链 | inbound hook 立即触发 | 写 resumeSignal + latestSourceMessageSeq，evaluator 消费增量 |
| P0: 缺少锁 | 无锁 | inflight Set + per-account 串行 + Phase 2 通过 Port 走 server 锁 |
| P1: 脆弱的 JSON/tag 解析 | JSON.parse + sentinel tag | 严格 system prompt + 多层 fallback + 不依赖 Phase 2 content tag |
| P1: 隔离切断记忆/模型 | `heartbeat:{goalId}` 独立分支 | Phase 1 用 sourceConversationId recall；Phase 2 在原会话执行 |
| P1: push 耦合状态 | evaluator 内直接 push | GoalTransition 输出 + 可选 requestPush |
| P1: token 预算落不实 | 依赖 ChatResponse（无 usage） | reasonInternal() 返回 usage，per-goal 累计 |
| P2: 递归 goal 爆炸 | 无保护 | isHeartbeatContext() 阻断 + per-account 配额 + 同源去重 |

## 实施顺序

### Phase A — 基础设施

1. 实现 `reasonInternal()` — 内部推理通道
2. 定义 `HeartbeatStore` port + Prisma 实现
3. 定义 `HeartbeatExecutorPort` + server 实现
4. 扩展 `MessageStore` 增加 `getMessagesSince()`
5. Prisma schema 增加 `PendingGoal` 表

### Phase B — 核心引擎

6. 实现 `engine.ts` — polling tick + per-account 串行
7. 实现 `evaluator.ts` — 两阶段评估 + GoalTransition 输出
8. 实现 `tool.ts` — Agent 工具（含递归保护）

### Phase C — 集成

9. server/agent.ts — post-chat hook 检查 waiting_user goals
10. server/runtime.ts — bootstrap / shutdown 生命周期
11. Tool 注册到 ToolRegistry

### Phase D — 加固

12. token 预算追踪 + per-account 限额
13. 日志 & observability span
14. scheduler → heartbeat 的可选联动（tool_failure → retry goal）
