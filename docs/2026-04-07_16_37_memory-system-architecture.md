# Tape 记忆系统架构方案

## 概述

Tape 是一个基于 **reducer 模式 + 增量锚点** 的 LLM 驱动长期记忆系统。核心思想：将对话中提取的结构化记忆存储为不可变的 Entry 流，通过 fold 函数将 Entry 归约为当前状态，并通过 Anchor 检查点优化重建性能。

```
核心公式: CurrentState = fold(LastAnchor.Snapshot, NewEntries[])
```

---

## 1. 数据模型

### 1.1 TapeEntry — 记忆条目

每条记忆是一个不可变的事件记录。

```
tape_entries
├── id          BigInt    @id @autoincrement
├── eid         UUID      @unique        # 全局唯一标识
├── accountId   String                   # 所属账号
├── branch      String                   # 分支（会话ID 或 __global__）
├── type        String                   # 'record'
├── category    String                   # 'fact' | 'preference' | 'decision' | 'summary'
├── payload     Json                     # EntryPayload: { fragments: Fragment[] }
├── actor       String                   # 'agent:claude-sonnet-4-20250514'
├── source      String?                  # 'chat' | 'tool:{name}' | 'compact'
├── prevHash    String?                  # 完整性链（预留）
├── compacted   Boolean   @default(false)# 是否已被压缩归档
└── createdAt   DateTime                 # 创建时间
```

**索引：**
- `(accountId, branch, type)` — 按分支和类型查询
- `(accountId, branch, createdAt)` — 增量查询（recall 核心路径）
- `(accountId, branch, compacted)` — 过滤已压缩条目

### 1.2 TapeAnchor — 状态检查点

定期生成的状态快照，避免每次都从头 fold。

```
tape_anchors
├── id            BigInt    @id @autoincrement
├── aid           UUID      @unique        # 全局唯一标识
├── accountId     String                   # 所属账号
├── branch        String                   # 分支
├── anchorType    String                   # 'checkpoint' | 'handoff' | 'decision'
├── snapshot      Json                     # SerializedTapeState（完整状态快照）
├── manifest      String[]                 # 生成此快照的 entry eid 列表
├── predecessors  String[]                 # 前驱 anchor aid（DAG 结构）
├── lastEntryEid  UUID?                    # 此快照覆盖的最后一条 entry
└── createdAt     DateTime                 # 创建时间
```

**索引：**
- `(accountId, branch, anchorType)` — 按分支和类型查询
- `(accountId, branch, createdAt)` — 查找最新 anchor

### 1.3 Fragment — 原子内容单元

Entry.payload 中的原子数据单元：

```typescript
interface Fragment {
  kind: "text" | "image" | "tool_call" | "observation" | "reference";
  data: Record<string, unknown>;  // 具体数据，如 { key, value, confidence }
  ref?: string;                   // 可选引用
}
```

### 1.4 TapeState — 运行时状态

fold 产生的内存状态表示：

```typescript
interface TapeState {
  facts: Map<string, TapeFact>;           // key → 事实
  preferences: Map<string, TapePreference>; // key → 偏好
  decisions: TapeDecision[];               // 时间线（仅追加）
  version: number;                         // 单调递增
}
```

| 字段 | TapeFact | TapePreference | TapeDecision |
|------|----------|----------------|--------------|
| key | 唯一标识 | 唯一标识 | — |
| value | 事实内容 | 偏好内容 | — |
| confidence | 0.0-1.0 | — | — |
| description | — | — | 决策描述 |
| context | — | — | 决策上下文 |
| sourceEid | 来源 entry | 来源 entry | 来源 entry |
| updatedAt/createdAt | ISO 时间 | ISO 时间 | ISO 时间 |

---

## 2. 分支模型

记忆按 branch 隔离，实现全局持久 vs 会话临时的分层：

```
account: user123
├── __global__           # 持久记忆（跨所有会话）
│   ├── fact: 用户姓名 = "Alice" (confidence: 0.95)
│   ├── fact: 邮箱 = "alice@example.com"
│   └── preference: 语言风格 = "简洁"
│
├── conv-abc             # 会话 1 的临时记忆
│   ├── decision: 选择用 Python 实现
│   └── fact: 当前项目 = "数据分析" (confidence: 0.7)
│
└── conv-abc#1712345678  # /reset 后的新会话
    └── (继承自 conv-abc 的高置信度记忆)
```

- **`__global__`**: 跨会话的持久信息（姓名、职业、长期偏好）
- **`{conversationId}`**: 当前会话的临时记忆
- **`{conversationId}#{timestamp}`**: /reset 产生的新会话分支

---

## 3. 核心算法

### 3.1 Fold — 状态归约

将 Entry 流归约为当前状态的纯函数：

```
fold(state, entry) → newState
```

**合并策略：**

| category | 策略 | 说明 |
|----------|------|------|
| fact | Last-write-wins | 相同 key 覆盖，保留 sourceEid 可追溯 |
| preference | Last-write-wins | 同上 |
| decision | Append | 仅追加，不去重（决策是时间线事件） |
| summary | Bulk merge | compact 产生的聚合条目，批量合并回状态 |

**特性：** fold 是纯函数，不修改输入状态，每次返回新对象。

### 3.2 Recall — 状态重建

从存储重建当前记忆状态：

```
recall(accountId, branch) → TapeState

1. 查找最新 anchor: SELECT ... WHERE (accountId, branch) ORDER BY createdAt DESC LIMIT 1
2. 查找增量 entries: SELECT ... WHERE (accountId, branch, compacted=false, createdAt > anchor.createdAt)
3. 归约: fold(anchor.snapshot || emptyState, entries) → currentState
```

**复杂度：** O(n) 其中 n = 自上次 anchor 以来的未压缩条目数。正常运行下 n < 200。

### 3.3 Record — 记录新记忆

将提取的记忆写入存储：

```
record(accountId, branch, params) → eid

INSERT INTO tape_entries (accountId, branch, type='record', category, payload, actor, source)
```

### 3.4 Compact — 检查点压缩

当未压缩条目数超过阈值（默认 200）时触发：

```
compactIfNeeded(accountId, branch, threshold=200) → boolean

1. 查找最新 anchor
2. 统计未压缩 entries 数量
3. 若 count < threshold → 跳过
4. recall() 获取当前完整状态
5. 原子事务：
   a. 创建 checkpoint anchor（含完整状态快照）
   b. 标记所有相关 entries 为 compacted=true
```

**效果：** 后续 recall 从新 checkpoint 开始，跳过所有已压缩条目。

### 3.5 Handoff — 会话轮转记忆迁移

/reset 时将有价值的记忆从旧会话迁移到新会话：

```
createHandoffAnchors(accountId, oldBranch, newBranch)

1. recall(oldBranch) → oldState
2. filterForHandoff(oldState):
   - 保留所有 preferences（偏好天然跨会话）
   - 保留 confidence >= 0.8 的 facts
   - 保留最近 20 条 decisions
   - 丢弃低置信度事实和过旧决策
3. 在 oldBranch 创建 handoff anchor
4. 在 newBranch 创建 handoff anchor（predecessors 指向旧 anchor）
```

### 3.6 Purge — 过期清理

定期清理已压缩的旧条目（默认保留 30 天）：

```
purgeCompacted(retentionDays=30) → deletedCount

DELETE FROM tape_entries WHERE compacted=true AND createdAt < (now - retentionDays)
```

由 server 的 12 小时定时器触发。

---

## 4. LLM 记忆提取

### 4.1 提取流程

异步 fire-and-forget，不阻塞用户回复：

```
用户消息 + 助手回复
        ↓
  fireExtractAndRecord()
        ↓
  callExtractor(model, turn)  ← LLM 调用
        ↓
  解析 JSON 数组
        ↓
  按 scope 路由:
  ├── global → queueRecordEntry(accountId, "__global__", ...)
  └── session → queueRecordEntry(accountId, conversationId, ...)
        ↓
  异步队列写入 DB
```

### 4.2 提取 Prompt

```
你是一个记忆提取器。分析下面的对话轮次，提取值得长期记住的结构化信息。

## 提取规则
只提取明确的、有价值的信息，不要猜测或推断。跳过：
- 临时性的问答
- 纯粹的任务执行细节
- Agent 自己的输出内容

## 输出格式
[
  {
    "category": "fact" | "preference" | "decision",
    "scope": "global" | "session",
    "key": "简短唯一标识",
    "value": "具体内容",
    "confidence": 0.0-1.0
  }
]
```

### 4.3 Scope 路由规则

| scope | 目标 branch | 场景 |
|-------|------------|------|
| global | `__global__` | 用户身份、长期偏好 |
| session | `{conversationId}` | 当前任务决策、临时上下文 |

### 4.4 跳过条件

当用户文本 < 5 字符 **且** 助手文本 < 20 字符时跳过提取（过短的交互不太可能包含有价值记忆）。

---

## 5. 记忆注入 Prompt

### 5.1 格式化

`formatMemoryForPrompt(globalMemory, sessionMemory)` 生成 XML 块注入用户消息：

```xml
<memory>
## 已知事实
- 用户姓名: "Alice"
- 邮箱: "alice@example.com"

## 用户偏好
- 语言风格: "简洁"

## 近期决策
- 选择用 Python 实现 (数据分析项目)
</memory>
```

### 5.2 合并规则

- **Facts**: global + session 合并，session 同 key 覆盖 global
- **Preferences**: 同上
- **Decisions**: 仅 session，取最近 5 条

### 5.3 注入位置

插入到用户消息的文本头部：

```
[当前时间: 2025/04/07 14:30 周一]

<memory>
...
</memory>

{用户原始文本}
```

---

## 6. 异步队列

### 6.1 Tape 写入队列

```typescript
// packages/agent/src/tape/queue.ts
interface QueueItem {
  accountId: string;
  branch: string;
  params: RecordParams;
  attempts: number;
}

const queue: QueueItem[] = [];
```

**重试策略：** 指数退避，最大 30 秒：`Math.min(30_000, 1_000 * 2^min(attempts, 5))`

### 6.2 消息持久化队列

```typescript
// packages/server/src/db/messages.ts
// 相同的队列模式，独立运行
```

两个队列独立运行，最终一致。

---

## 7. 对话历史管理

### 7.1 内存缓存

```typescript
const store = new Map<string, Message[]>();      // accountId::convId → 消息列表
const seqCounters = new Map<string, number>();   // accountId::convId → 下一个 seq
const loading = new Map<string, Promise<Message[]>>(); // 防止重复加载
```

### 7.2 会话锁

每个 `accountId::conversationId` 有独立的异步锁，防止并发消息处理导致状态混乱：

```typescript
withConversationLock(accountId, conversationId, async () => {
  // 同一会话的消息串行处理
  await chat(accountId, conversationId, text, media);
});
```

**实现：** 基于 Promise 的 FIFO 队列，不使用第三方库。

### 7.3 驱逐策略

- `/reset` 时调用 `evictConversation()` 清除旧会话的内存缓存
- DB 数据保留，下次访问时重新加载
- `clearConversation()` 同时清除内存和 DB

### 7.4 错误回滚

LLM 返回错误或空响应时，回滚本轮产生的所有消息：

```typescript
if (!replyText && msg.stopReason !== "stop") {
  await rollbackMessages(accountId, conversationId, messagesAddedInRun);
  // 不触发记忆提取
}
```

---

## 8. Port 接口 — 依赖倒置

Agent 定义接口，Server 注入实现，Agent 不依赖 Prisma：

```
agent/src/ports/
├── tape-store.ts       # TapeStore 接口
├── message-store.ts    # MessageStore 接口
├── scheduler-store.ts  # SchedulerStore 接口
└── push-service.ts     # PushService 接口

server/src/db/
├── tape-store.impl.ts       # PrismaTapeStore implements TapeStore
├── message-store.impl.ts    # PrismaMessageStore implements MessageStore
└── scheduler-store.impl.ts  # PrismaSchedulerStore implements SchedulerStore
```

**注入时机：** Server 启动时在 `ai.ts`（bootstrap）中调用：

```typescript
setTapeStore(new PrismaTapeStore());
setMessageStore(new PrismaMessageStore());
setSchedulerStore(new PrismaSchedulerStore());
setPushService({ sendProactiveMessage });
```

---

## 9. 完整数据流

### 9.1 用户消息 → 记忆提取 → 注入 → 回复

```
用户发送 "我叫 Alice"
│
├─ 1. 加载历史 + 记忆（并行）
│  ├─ ensureHistoryLoaded() → 从 DB 恢复 Message[]
│  ├─ recall(accountId, conversationId) → sessionMemory
│  └─ recall(accountId, "__global__") → globalMemory
│
├─ 2. 格式化记忆 → 注入 prompt
│  └─ formatMemoryForPrompt(global, session) → <memory>...</memory>
│
├─ 3. 构建用户消息 → push 到 history → 异步持久化
│
├─ 4. LLM 推理（可能多轮 tool 调用）
│  └─ runner.run(history, callbacks) → 每条消息异步持久化
│
├─ 5. 成功时：异步提取记忆
│  └─ fireExtractAndRecord() → LLM 提取 → 队列写入
│
├─ 6. 成功时：检查压缩
│  └─ compactIfNeeded() → 超阈值则创建 checkpoint
│
└─ 7. 返回 ChatResponse
```

### 9.2 /reset 会话轮转

```
用户发送 "/reset"
│
├─ 1. 命令拦截 → resetCommand.execute()
│
├─ 2. rotateSession()
│  ├─ createHandoffAnchors(old, new) → 迁移高价值记忆
│  ├─ evictConversation(old) → 清除旧会话内存缓存
│  └─ upsertRoute() → 持久化新会话映射
│
└─ 3. 返回 "已开启新会话，之前的对话已存档。"
```

---

## 10. 可观测性

所有关键操作被 OpenTelemetry span 包裹：

| Span 名称 | 位置 | 监控项 |
|-----------|------|--------|
| `agent.chat` | chat.ts | 完整对话周期 |
| `history.load` | chat.ts | 历史加载耗时 |
| `tape.recall` | chat.ts | 记忆重建耗时 |
| `tape.extract` | extractor.ts | LLM 提取耗时 + 提取数量 |
| `tape.compact` | chat.ts | 压缩耗时 |
| `conversation.lock` | agent.ts | 锁等待时间 |
| `llm.call` | runner.ts | LLM 调用延迟 + token 用量 |
| `tool.execute` | runner.ts | 工具执行耗时 |

---

## 11. 容错机制

| 场景 | 处理方式 |
|------|---------|
| Tape recall 失败 | 降级为空状态，对话继续 |
| LLM 提取失败 | 错误日志，不重试，不影响回复 |
| 队列写入失败 | 指数退避重试（最多 ~30s） |
| LLM 返回空响应 | 回滚本轮所有消息 |
| 压缩失败 | 警告日志，下次 recall 自动补偿 |
| Handoff 失败 | 警告日志，新会话从空记忆开始 |

---

## 12. 性能特征

| 操作 | 复杂度 | 典型耗时 |
|------|--------|---------|
| recall | O(未压缩条目数) | < 50ms（正常） |
| compact | O(1) DB 事务 | 100-500ms |
| extract | LLM 调用 | 500ms-2s（异步） |
| formatMemoryForPrompt | O(facts + prefs + decisions) | < 5ms |
| 压缩触发阈值 | 200 条未压缩 entries | — |
| 过期清理保留 | 30 天 | 每 12 小时检查 |

---

## 13. 文件清单

| 文件 | 包 | 职责 |
|------|-----|------|
| `tape/types.ts` | agent | 类型定义 |
| `tape/fold.ts` | agent | 状态归约算法 |
| `tape/service.ts` | agent | recall / compact / handoff / format |
| `tape/extractor.ts` | agent | LLM 记忆提取 |
| `tape/queue.ts` | agent | 异步写入队列 |
| `ports/tape-store.ts` | agent | 存储接口定义 |
| `ports/message-store.ts` | agent | 消息存储接口定义 |
| `db/tape-store.impl.ts` | server | Prisma 实现 TapeStore |
| `db/message-store.impl.ts` | server | Prisma 实现 MessageStore |
| `db/messages.ts` | server | 消息持久化 + 队列 |
| `conversation/history.ts` | agent | 内存缓存 + 会话锁 |
| `chat.ts` | agent | 对话编排（集成记忆） |
| `ai.ts` | server | Bootstrap + Port 注入 |
