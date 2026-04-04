# Tape 记忆架构 — 存储层方案

> 用 Tape（追加式日志）理念为 clawbot Agent 构建跨会话记忆系统。本文档讨论存储层选型、数据模型设计，以及如何与现有 `Conversation` / `Message` / `Trace` 体系融合。

## 1. tape.systems 核心理念

> **Context as a Function of Memory** — 上下文是记忆的函数。

tape.systems 的底层哲学：

- **数据的本质是流（Stream）**：不维护一个时刻变化的数据库状态，而维护一条永不消失的事实流。传统做法 `UPDATE SET status = 'done'` 丢失了"什么时候变"和"为什么变"的历史；Tape 做法是 `Append Entry(Fact: status changed to 'done', Reason: 'CI passed') + Create Anchor(State: {status: 'done'})`。
- **视图是按需生成的（Views are projections）**：用户看到的界面（聊天窗口、代码视图）只是对 Tape 的一种特定映射（projection），不是真理来源。
- **确定性重建（Deterministic Rebuild）**：只要拥有 Tape 及其 Entry 序列，任何人在任何时间、任何地点都能重建出完全一致的上下文状态。

这种架构极其适合 AI Agent 系统，因为 Agent 需要频繁地回顾历史、纠正错误以及在不同任务间切换上下文。

## 2. 问题背景

### 2.1 当前系统的记忆能力

clawbot 的对话存储是 **会话级别的线性日志**：

- **内存层**：`packages/server/src/conversation.ts` 维护 `Map<string, Message[]>` 作为热缓存，以 `${accountId}::${conversationId}` 为 key
- **持久层**：`packages/server/src/db/messages.ts` 通过异步队列将 `Message` 写入 PostgreSQL（Supabase），以 `(accountId, conversationId, seq)` 作唯一约束
- **会话隔离**：`SessionRoute` 模型通过 `wechatConvId → effectiveConvId` 映射实现会话切割（`/reset` 命令触发 `rotateSession()`，生成 `${wechatConvId}#${Date.now()}` 新 ID）

这套系统的局限在于：

1. **无跨会话记忆** — `/reset` 后旧会话的知识完全丢失，Agent 无法回忆"上次聊过什么"
2. **无结构化状态** — 所有历史都是扁平的 `Message[]` 数组，没有摘要、没有关键事实提取
3. **无上下文压缩** — `agent-architecture.md` 明确标注 "Context 管理 / overflow 处理" 和 "Checkpoint / epoch 存储" 留待后续
4. **单向追加** — 虽然有 `rollbackMessages()` 做错误回滚，但没有正向的 compact / fold 能力

### 2.2 Tape 架构要解决什么

Tape 在现有 `Message` 日志之上增加一层 **结构化记忆**，支持三个核心操作：

| 操作 | 含义 | 类比 |
|---|---|---|
| **record** | 追加一条 Entry（事实、偏好、决策等） | 类似现在的 `history.push()` + `queuePersistMessage()` |
| **recall** | 从最近的 Anchor 快照开始，读取后续增量 Entry，重建状态 | 类似现在的 `restoreHistory()` 但支持折叠 |
| **compact** | 将多条 Entry fold 成一个新的 Anchor 快照，压缩历史 | 现有系统完全缺失的能力 |

## 3. 核心原则：不要过早分布式化

文档方案建议 PostgreSQL 存 Entry + Redis 存 Anchor 快照 + 向量库做语义索引。这在实践中存在致命问题——**三个系统之间的一致性谁来保证？**

- Entry 写进了 PG 但 Anchor 还没刷到 Redis，Agent 读到的状态不一致
- 向量索引和 Entry 之间有延迟，语义检索拿到的结果和真实时间线对不上

Tape 架构的核心价值是**确定性重建**——同一条 Tape 在任何时间任何地点重建出一致的状态。三套存储直接破坏了这个承诺。

**结论：单存储引擎，事务一致性优先。**

## 4. 存储选型：复用现有 PostgreSQL

### 4.1 为什么不引入新的存储

项目已有的基础设施：

```
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")      // Supabase pooler (port 6543)
  directUrl = env("DIRECT_URL")        // Supabase direct (port 5432)
}
```

已有 10 个 Prisma model（`Account`, `Conversation`, `Message`, `SessionRoute`, `McpServer`, `McpTool`, `Trace`, `TraceSpan`, `WebhookToken` 等），迁移管线成熟。**直接加表，零额外运维成本。**

SQLite 的场景（单进程嵌入式 Agent）与本项目不匹配——clawbot 是多账号并发的微信机器人服务端，已经依赖 PostgreSQL 做消息持久化、Trace 存储和 Webhook 日志。

### 4.2 为什么不用 Redis 存 Anchor

项目现有的读取模式已经验证了"PG 够快"这个假设：

```typescript
// packages/server/src/db/messages.ts — restoreHistory()
const data = await getPrisma().message.findMany({
  where: { accountId, conversationId },
  orderBy: { seq: "asc" },
});
```

`restoreHistory()` 在每次对话冷启动时从 PG 加载全量历史，实测在数百条消息量级下毫秒内完成。Anchor 的读取频率更低——只在 recall 时读一次最新 Anchor + 后续增量 Entry。加了索引后这两个查询都在毫秒级，Redis 的微秒级加速完全没有必要。

## 5. 数据模型

### 5.0 tape.systems 底层数据模型概览

根据 tape.systems 规范，Tape 的底层数据模型由三个核心组件构成：

#### Entry（条目）— 最小存储单元

Entry 是一个不可变的信封（Envelope），包裹着具体的事实数据：

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| **eid** | 唯一标识符 | 使用 ULID/KSUID（单调递增且包含时间戳），保证时间轴自然排序 |
| **fact** | 事实负载 | 实际数据（JSON/Protobuf），代表一次状态变更或一条信息 |
| **meta.actor** | 行为者 | 谁产生的这条记录（用户 ID、AI Agent ID） |
| **meta.source** | 来源 | 产生该记录的工具或环境 |
| **meta.timestamp** | 墙上时钟 | Wall clock time |
| **prev** | 前驱引用 | 指向前一个 Entry 的指针，形成哈希链（类似区块链），确保完整性 |

#### Anchor（锚点）— 状态检查点

Anchor 是 Tape 的"脊梁"。没有 Anchor，获取当前状态必须从头读取整条 Tape；有了 Anchor，可以直接从最近的检查点开始：

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| **id** | 唯一标识符 | 与 Entry 类似 |
| **type** | 锚点类型 | `checkpoint`（常规压缩）、`handoff`（上下文切换）、`decision`（决策点） |
| **snapshot** | 状态快照 | 所有先前 Entry 累积计算后的结构化状态（不是原始数据，是 fold 的结果） |
| **manifest** | 依赖清单 | 构建此快照所依赖的关键 Entry ID 列表（可追溯性的关键） |
| **predecessors** | 前驱锚点 | 指向前一个或多个 Anchor，形成**有向无环图（DAG）**——支持分支与合并 |

#### Fragment（片段）— Fact 内部的内容组织

在 Fact 内部，内容被组织为 Fragment，解决复杂对话或多模态数据的存储问题：

- **Atomic**：每个 Fragment 是不可分割的信息块（一段文字、一个文件引用、一个工具调用结果）
- **Typed**：每个片段有明确的 Schema 类型定义（`text`, `image`, `tool_call`, `observation`）
- **Referential**：Fragment 之间可以相互引用

### 5.1 Prisma Schema 扩展

在现有 `schema.prisma` 中新增 `TapeEntry` 和 `TapeAnchor` 模型：

```prisma
model TapeEntry {
  id         BigInt   @id @default(autoincrement())
  eid        String   @unique @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId  String   @map("account_id") @db.Text
  branch     String   @db.Text

  // --- tape.systems Entry 规范字段 ---
  type       String   @db.Text                           // 'record' | 'anchor'
  category   String   @db.Text                           // 'fact' | 'preference' | 'decision' | 'summary' | ...

  // Fact 负载：结构化为 Fragment 数组
  // payload.fragments: Array<{ kind: 'text'|'image'|'tool_call'|'observation', data: any, ref?: eid }>
  payload    Json

  // Meta 元数据
  actor      String   @db.Text                           // 产生者标识：'user:{accountId}' | 'agent:{modelId}' | 'system'
  source     String?  @db.Text                           // 来源工具/环境：'chat' | 'tool:{toolName}' | 'compact'

  // 哈希链（完整性校验，非必须——clawbot 单信任方场景下可为 null）
  // 规范中 prev 形成哈希链确保 Tape 不被篡改；在单信任方系统中 id 自增序列已保证时序，
  // 此字段保留为可选，仅在需要跨系统同步或审计时启用
  prevHash   String?  @map("prev_hash") @db.Text         // sha256(前一个 entry 的 eid + payload)

  compacted  Boolean  @default(false)
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  account    Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  // 主查询：从最新 Anchor 开始读取增量
  @@index([accountId, branch, type], map: "idx_tape_branch_type")
  // 时序范围查询（recall 增量读取）
  @@index([accountId, branch, createdAt], map: "idx_tape_branch_created")
  // 全文检索（flashback 场景）
  @@index([accountId, branch, compacted], map: "idx_tape_branch_compacted")
  @@map("tape_entries")
}

/// Anchor 独立模型 — 与 Entry 分离，因为 Anchor 携带了 Entry 不具备的结构（manifest/predecessors/DAG）
model TapeAnchor {
  id             BigInt   @id @default(autoincrement())
  aid            String   @unique @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  accountId      String   @map("account_id") @db.Text
  branch         String   @db.Text

  // 锚点类型：checkpoint（常规压缩）| handoff（上下文切换/reset）| decision（决策点）
  anchorType     String   @map("anchor_type") @db.Text

  // 状态快照：所有先前 Entry fold 后的结构化结果
  snapshot       Json

  // 依赖清单：构建此快照所依赖的关键 Entry eid 列表
  // 用途：compact 后即使旧 Entry 被物理删除，仍可追溯快照由哪些事实推导而来
  manifest       String[] @default([])                    // Entry eid[] — 关键事实的 ID 列表

  // 前驱锚点 DAG：指向前一个或多个 Anchor 的 aid
  // 线性 compact → 单个前驱；handoff 分支 → 可能有多个前驱（合并场景）
  predecessors   String[] @default([])                    // TapeAnchor aid[]

  // 关联的最后一个 Entry 的 eid（用于 recall 时确定增量读取的起点）
  lastEntryEid   String?  @map("last_entry_eid") @db.Uuid

  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  account        Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, branch, anchorType], map: "idx_anchor_branch_type")
  @@index([accountId, branch, createdAt], map: "idx_anchor_branch_created")
  @@map("tape_anchors")
}
```

同时在 `Account` 模型中添加关联：

```prisma
model Account {
  // ... 现有字段 ...
  tapeEntries    TapeEntry[]
  tapeAnchors    TapeAnchor[]
}
```

### 5.2 为什么 Entry 和 Anchor 分为两张表

原方案将 Entry 和 Anchor 放在同一张表（通过 `type` 字段区分），这是一个简化决策。根据 tape.systems 规范，Anchor 携带了 Entry 不具备的关键结构：

| 特性 | Entry | Anchor |
| --- | --- | --- |
| **manifest**（依赖清单） | 无 | 有 — 记录快照由哪些 Entry 推导 |
| **predecessors**（前驱 DAG） | 无 | 有 — 支持分支合并 |
| **snapshot**（聚合状态） | 无 | 有 — fold 后的完整状态 |
| **写入频率** | 高（每轮对话可能多条） | 低（每 N 条 Entry compact 一次） |
| **查询模式** | 范围扫描（时序增量） | 点查（最新一个） |

将 Anchor 的 `manifest[]` 和 `predecessors[]` 塞进 Entry 的 JSONB payload 会导致：查询 Anchor 时无法利用数组索引做 DAG 遍历；Entry 表的行大小不均匀（Anchor 行远大于普通 Entry）。分表后各自的索引和查询路径更清晰。

时序线上的关系：

```
Entry_1 → Entry_2 → ... → Entry_200 → Anchor_v1 → Entry_201 → ... → Entry_400 → Anchor_v2
                                          ↑                                          ↑
                                    snapshot={fold 结果}                       snapshot={新 fold 结果}
                                    manifest=[eid_1..eid_200]                  manifest=[eid_201..eid_400]
                                    predecessors=[]                            predecessors=[aid_v1]
```

### 5.3 与现有模型的映射关系

| 现有模型 | Tape 概念 | 关系 |
| --- | --- | --- |
| `Account` | Tape 的所有者 | `TapeEntry.accountId` / `TapeAnchor.accountId` → `Account.id` |
| `Conversation` (effectiveConvId) | Branch | `branch` = `effectiveConvId`，一个会话一条 Tape |
| `Message.seq` | Entry 的时序 | Message 记录原始对话，TapeEntry 记录从对话中提取的结构化记忆 |
| `withConversationLock()` | Branch 级写入串行化 | Tape 写入复用同一个锁 |
| `SessionRoute` | Branch 路由 + Handoff | `/reset` 产生新 Branch，同时创建 `handoff` 类型的 Anchor 携带精简状态（见 §5.5） |

**关键区分：`Message` 和 `TapeEntry` 不是同一个东西。**

- `Message` 是原始对话日志（用户说了什么、LLM 回了什么、工具返回了什么），用于 LLM 的 context window
- `TapeEntry` 是从对话中提取的结构化记忆（用户的偏好、确认的事实、做出的决策），用于跨会话的知识持久化

举例：用户说"我不吃辣"，Message 存的是完整对话，TapeEntry 存的是：

```typescript
{
  category: "preference",
  actor: "agent:claude-sonnet-4-20250514",
  source: "chat",
  payload: {
    fragments: [
      { kind: "text", data: { key: "饮食偏好", value: "不吃辣", confidence: 0.95 } }
    ]
  }
}
```

### 5.4 全局记忆 vs 会话记忆

`branch` 字段的设计支持两种记忆范围：

| Branch 值 | 含义 | 场景 |
| --- | --- | --- |
| `effectiveConvId` | 会话级记忆 | 当前对话的上下文、临时偏好、进行中的任务 |
| `__global__` | 账号级全局记忆 | 用户姓名、持久偏好、长期事实（跨所有会话共享） |

recall 时先读全局 Anchor + 增量，再读当前会话 Anchor + 增量，合并后注入 system prompt。

### 5.5 Handoff 分支：`/reset` 与跨会话记忆的桥梁

> 对应 tape.systems 规范中的 **Handoff & Branching** 机制。

当前 `/reset` 的行为（`rotateSession()`）会生成新的 `effectiveConvId`，但新旧 Branch 之间**零关联**。规范中 Handoff 是一种特殊 Anchor，用于上下文切换时携带精简状态进入新 Branch：

```
旧 Branch (conv_abc)                          新 Branch (conv_abc#1712345678)
... → Entry_N → Anchor(handoff)  ─────────→   Anchor(handoff) → Entry_1 → ...
                    ↑                              ↑
              snapshot={精简状态}             predecessors=[旧 branch 的 handoff aid]
              过滤掉临时上下文               继承持久偏好和关键事实
```

实现要点：

```typescript
// rotateSession() 扩展——创建 handoff anchor
async function rotateSession(accountId: string, wechatConvId: string): Promise<string> {
  const oldEffective = sessionCache.get(k) ?? wechatConvId;
  const newEffective = `${wechatConvId}#${Date.now()}`;

  // 1. 在旧 Branch 创建 handoff Anchor（携带精简状态）
  const oldState = await recall(accountId, oldEffective);
  const handoffSnapshot = filterForHandoff(oldState); // 只保留持久偏好和关键事实，丢弃临时上下文
  const handoffAnchor = await createAnchor({
    accountId, branch: oldEffective,
    anchorType: "handoff",
    snapshot: handoffSnapshot,
    manifest: extractKeyEntryEids(oldState),
  });

  // 2. 在新 Branch 创建对应的 handoff Anchor（predecessors 指回旧 Branch）
  await createAnchor({
    accountId, branch: newEffective,
    anchorType: "handoff",
    snapshot: handoffSnapshot,
    predecessors: [handoffAnchor.aid],  // DAG 连接
  });

  // 3. 原有的 session 切换逻辑
  evictConversation(accountId, oldEffective);
  sessionCache.set(k, newEffective);
  await upsertRoute(accountId, wechatConvId, newEffective);
  return newEffective;
}
```

这样 `/reset` 后 Agent 不再完全失忆——新 Branch 的 handoff Anchor 携带了旧会话中值得保留的记忆，同时通过 `predecessors` DAG 保留了可追溯性。

## 6. 核心操作的实现

> 对应 tape.systems 的三步运作逻辑：**Append & Sequence → Folding/Reduction → Handoff & Branching**

### 6.0 TapeState 类型定义与 Reducer 语义

> 规范核心公式：`CurrentState = Reducer(LastAnchor.Snapshot, NewEntries[])`

在实现 record / recall / compact 之前，必须先定义 `TapeState` 的具体类型和 `fold` 的合并语义——这是整个 Tape 架构的计算核心：

```typescript
// packages/tape/src/types.ts

/** Tape 状态的结构化表示——Anchor.snapshot 和 recall() 的返回值 */
export interface TapeState {
  /** 事实库：key 唯一，后写覆盖（last-write-wins） */
  facts: Map<string, TapeFact>;
  /** 偏好库：key 唯一，后写覆盖 */
  preferences: Map<string, TapePreference>;
  /** 决策记录：追加式，不去重 */
  decisions: TapeDecision[];
  /** 状态版本号（每次 fold 递增，用于乐观并发控制） */
  version: number;
}

export interface TapeFact {
  key: string;
  value: unknown;
  confidence: number;        // 0-1，LLM 提取时的置信度
  sourceEid: string;         // 产生该事实的 Entry eid（可追溯性）
  updatedAt: string;         // ISO timestamp
}

export interface TapePreference {
  key: string;
  value: unknown;
  sourceEid: string;
  updatedAt: string;
}

export interface TapeDecision {
  description: string;
  context: string;
  sourceEid: string;
  createdAt: string;
}
```

Reducer（fold）函数的合并策略：

```typescript
// packages/tape/src/fold.ts

export function emptyState(): TapeState {
  return { facts: new Map(), preferences: new Map(), decisions: [], version: 0 };
}

/**
 * 将单条 Entry 应用到当前状态，返回新状态。
 * 这是 tape.systems 的 Reducer 函数实现。
 *
 * 合并策略：
 * - fact / preference → last-write-wins（同 key 后写覆盖，保留 sourceEid 可追溯）
 * - decision → 追加（决策是时间线上的事件，不做去重）
 * - summary → 批量合并（compact 产生的聚合条目）
 */
export function fold(state: TapeState, entry: TapeEntry): TapeState {
  const next = shallowClone(state);
  next.version++;

  switch (entry.category) {
    case "fact": {
      const fragments = entry.payload.fragments ?? [];
      for (const f of fragments) {
        next.facts.set(f.data.key, {
          key: f.data.key,
          value: f.data.value,
          confidence: f.data.confidence ?? 1,
          sourceEid: entry.eid,
          updatedAt: entry.createdAt,
        });
      }
      break;
    }
    case "preference": {
      const fragments = entry.payload.fragments ?? [];
      for (const f of fragments) {
        next.preferences.set(f.data.key, {
          key: f.data.key,
          value: f.data.value,
          sourceEid: entry.eid,
          updatedAt: entry.createdAt,
        });
      }
      break;
    }
    case "decision": {
      const fragments = entry.payload.fragments ?? [];
      for (const f of fragments) {
        next.decisions.push({
          description: f.data.description,
          context: f.data.context ?? "",
          sourceEid: entry.eid,
          createdAt: entry.createdAt,
        });
      }
      break;
    }
  }

  return next;
}
```

### 6.1 record — 追加 Entry（Append & Sequence）

在现有的 `chat()` 流程中（`packages/server/src/ai.ts`），Agent 完成一轮对话后，从 LLM 响应中提取结构化记忆并写入 Tape。

**注意调用时机**：record 必须在 rollback 判断之后执行（`ai.ts` 中 `rollbackMessages()` 之后），避免"消息回滚了但记忆没回滚"的不一致：

```typescript
// 伪代码——嵌入 ai.ts 的 chat() 函数中，rollback 判断之后
if (result.status === "completed") {
  const msg = result.finalMessage;
  const text = extractAssistantText(msg);

  // ❌ 错误响应时先 rollback，不提取记忆
  if (!text && msg.stopReason !== "stop") {
    await rollbackMessages(accountId, conversationId, messagesAddedInRun);
    // 不执行 record
  } else {
    // ✅ 正常响应后提取记忆
    const memories = extractMemories(result.finalMessage);
    for (const mem of memories) {
      await tapeService.record(accountId, effectiveConvId, {
        category: mem.category,
        actor: `agent:${MODEL_ID}`,
        source: "chat",
        payload: { fragments: mem.fragments },
      });
    }
  }
}
```

写入路径复用现有的异步队列模式（参考 `queuePersistMessage()` 的设计）：

```typescript
// packages/tape/src/queue.ts
export function queueRecordEntry(params: {
  accountId: string;
  branch: string;
  category: string;
  actor: string;
  source?: string;
  payload: { fragments: Fragment[] };
}): void {
  // 与 queuePersistMessage() 同样的 queue + flushQueue + retry 模式
  // id 自增序列保证时序，无需查询 prev entry
}
```

### 6.2 recall — 状态折叠（Folding/Reduction）

> `CurrentState = Reducer(LastAnchor.Snapshot, NewEntries[])`

```typescript
export async function recall(
  accountId: string,
  branch: string,
): Promise<TapeState> {
  const prisma = getPrisma();

  // 1. 找到该 branch 最新的 Anchor
  const anchor = await prisma.tapeAnchor.findFirst({
    where: { accountId, branch },
    orderBy: { createdAt: "desc" },
  });

  // 2. 读取 Anchor 之后的所有增量 Entry
  const incremental = await prisma.tapeEntry.findMany({
    where: {
      accountId,
      branch,
      compacted: false,
      ...(anchor?.lastEntryEid
        ? { eid: { not: anchor.lastEntryEid }, createdAt: { gt: anchor.createdAt } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  // 3. fold：将 Anchor snapshot + 增量 Entry 合并为当前状态
  const baseState = anchor ? deserializeState(anchor.snapshot) : emptyState();
  return incremental.reduce((state, entry) => fold(state, entry), baseState);
}
```

这个函数的调用时机是 `ensureHistoryLoaded()` 的平行操作——在对话冷启动时，同时加载 Message 历史和 Tape 状态：

```typescript
// packages/server/src/ai.ts — chat() 内
await withSpan("history.load", { conversationId, accountId }, async () => {
  await ensureHistoryLoaded(accountId, conversationId);
});

// 新增：并行加载 Tape 记忆
const [sessionMemory, globalMemory] = await withSpan(
  "tape.recall",
  { conversationId, accountId },
  () => Promise.all([
    recall(accountId, conversationId),      // 会话级记忆
    recall(accountId, "__global__"),         // 全局记忆
  ]),
);
```

recall 出来的状态注入到 system prompt 或作为首条 user message 的前缀：

```typescript
const memoryContext = formatMemoryForPrompt(globalMemory, sessionMemory);
// 追加到 runner.run() 的 systemPrompt 中
```

### 6.3 compact — 压缩历史（创建 Checkpoint Anchor）

当最新 Anchor 之后的 Entry 数超过阈值时触发 Compaction。compact 创建一个 `checkpoint` 类型的 Anchor，携带 manifest（可追溯性）和 predecessors（DAG 连接）：

```typescript
export async function compactIfNeeded(
  accountId: string,
  branch: string,
  threshold = 200,
): Promise<boolean> {
  const prisma = getPrisma();

  // 在 conversation lock 内执行，保证串行
  const latestAnchor = await prisma.tapeAnchor.findFirst({
    where: { accountId, branch },
    orderBy: { createdAt: "desc" },
  });

  const entries = await prisma.tapeEntry.findMany({
    where: {
      accountId,
      branch,
      compacted: false,
      ...(latestAnchor ? { createdAt: { gt: latestAnchor.createdAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  if (entries.length < threshold) return false;

  // 执行 compact：fold → 创建 Anchor → 标记旧 Entry
  const currentState = await recall(accountId, branch);
  const entryEids = entries.map((e) => e.eid);
  const lastEntry = entries[entries.length - 1];

  await prisma.$transaction(async (tx) => {
    // 1. 创建 checkpoint Anchor（携带 manifest 和 predecessors）
    await tx.tapeAnchor.create({
      data: {
        accountId,
        branch,
        anchorType: "checkpoint",
        snapshot: serializeState(currentState),
        manifest: entryEids,                              // 可追溯：快照由哪些 Entry 推导
        predecessors: latestAnchor ? [latestAnchor.aid] : [], // DAG：指向前驱 Anchor
        lastEntryEid: lastEntry.eid,
      },
    });

    // 2. 标记旧 Entry 为 compacted
    await tx.tapeEntry.updateMany({
      where: { id: { in: entries.map((e) => e.id) } },
      data: { compacted: true },
    });
  });

  return true;
}
```

### 6.4 调用时机在完整请求链路中的位置

参照 `packages/server/src/agent.ts` 中的 `createAgent()` 流程：

```text
WeChat SDK → Agent.chat(req)
  │
  ├─ getEffectiveConvId()                    // SessionRoute 路由
  │
  └─ runWithTrace(accountId, effectiveConvId, async () => {
       │
       ├─ withSpanSync("message.receive")    // 记录收到消息
       │
       ├─ withSpanSync("command.dispatch")   // 检查 /命令
       │  └─ 如果匹配 → 执行命令，直接返回
       │      └─ /reset → rotateSession() + handoff anchor（§5.5）
       │
       └─ withConversationLock(accountId, effectiveConvId, async () => {
            │
            ├─ withSpan("history.load")      // 加载 Message 历史
            │  └─ ensureHistoryLoaded()
            │
            ├─ withSpan("tape.recall")       // 加载 Tape 记忆
            │  ├─ recall(accountId, effectiveConvId)   // 会话记忆
            │  └─ recall(accountId, "__global__")      // 全局记忆
            │
            ├─ 构造 UserMessage + 注入记忆上下文
            │
            ├─ runner.run(history, callbacks) // LLM 对话循环
            │
            ├─ rollback 判断                  // ⚠️ 必须在 record 之前
            │
            ├─ withSpan("tape.record")       // 提取并记录新记忆（rollback 后才执行）
            │  └─ extractMemories() → record()
            │
            └─ withSpan("tape.compact")      // 按需压缩
               └─ compactIfNeeded()
          })
     })
```

## 7. 并发策略

### 7.1 复用现有的 Conversation Lock

项目已有完善的会话级锁机制（`packages/server/src/conversation.ts`）：

```typescript
const waitQueues = new Map<string, Array<() => void>>();

export async function withConversationLock<T>(
  accountId: string,
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = key(accountId, conversationId);
  const release = await acquireConversationLock(lockKey);
  try {
    return await fn();
  } finally {
    release();
  }
}
```

Tape 的 record / compact 操作都在 `withConversationLock()` 内执行（和现有的 `chat()` 调用共享同一把锁），天然保证了同一 Branch 的写入串行化。

### 7.2 不需要 Advisory Lock

文档方案提到用 PostgreSQL advisory lock 做 Branch 级串行化。但在本项目中，**应用层的 `withConversationLock()` 已经够用了**——因为只有一个 server 进程在跑（单节点部署）。所有对同一个 `(accountId, conversationId)` 的并发请求都会在应用层排队。

如果未来需要水平扩展到多节点，再引入 advisory lock：

```sql
-- 用 Conversation.id (BigInt) 做 lock key，避免哈希碰撞
SELECT pg_advisory_xact_lock(conversation_db_id);
```

注意用 `Conversation.id`（数据库自增 BigInt）而不是 `hashtext(conversationId)`，因为后者的哈希碰撞会导致不相关的 Branch 互相阻塞。

### 7.3 全局记忆的并发

`__global__` Branch 的写入锁 key 是 `${accountId}::__global__`，与会话级 Branch 独立。多个会话同时写全局记忆时会排队，但这是低频操作（只有当 Agent 从对话中提取到值得长期记住的信息时才写），不会成为瓶颈。

## 8. Fragment 处理（大对象）

> Fragment 是 tape.systems 规范中 Fact 内部的内容组织形式——每个 Fragment 是一个 Atomic（不可分割）、Typed（有 Schema）、Referential（可互相引用）的信息块。

### 8.1 与现有媒体缓存机制的对齐

项目已有图片缓存机制（`packages/server/src/db/messages.ts`）：

```typescript
// serializeMessage() 中的图片处理逻辑：
// 1. 将 base64 图片数据写入 MEDIA_CACHE_DIR
// 2. Message.payload 中存 filePath 引用
// 3. restoreHistory() 时通过 hydrateMessage() 从磁盘还原 base64

async function copyMediaToCache(sourcePath, accountId, conversationId, seq): Promise<string> {
  const fileName = `${accountId}-${conversationId}-${seq}-${randomUUID()}${extension}`;
  const targetPath = join(MEDIA_CACHE_DIR, fileName);
  await copyFile(sourcePath, targetPath);
  return targetPath;
}
```

Tape 的 Fragment 处理直接复用这个模式：

| 大小 | 处理方式 | 原因 |
|---|---|---|
| ≤ 256KB | 内联进 `TapeEntry.payload` 的 JSONB 字段 | PostgreSQL TOAST 机制自动压缩 >2KB 的字段，对应用层透明 |
| > 256KB | 存文件系统（`MEDIA_CACHE_DIR`），payload 中只存 `{ filePath: "..." }` | 与现有 `Message` 的图片存储模式一致 |

### 8.2 Fragment 类型定义

```typescript
// packages/tape/src/types.ts

/** Entry.payload.fragments 中的单个片�� */
export interface Fragment {
  /** 片段类型：决定了 data 的 schema */
  kind: "text" | "image" | "tool_call" | "observation" | "reference";
  /** 片段负载，schema 由 kind 决定 */
  data: Record<string, unknown>;
  /** 可选：引用其他 Fragment 或 Entry 的 eid */
  ref?: string;
}
```

Fragment 类型与现有 `Message.content` 块类型的对应关系：

| Fragment kind | 对应的 Message content type | 说明 |
| --- | --- | --- |
| `text` | `TextContent` | 结构化事实/偏好/决策的文本描述 |
| `image` | `ImageContent` | 图片引用（存 filePath，不存 base64） |
| `tool_call` | `ToolCallContent` | Agent 工具调用的结构化记录 |
| `observation` | `ToolResultContent` | 工具返回结果的摘要 |
| `reference` | 无对应 | Fragment 间的交叉引用 |

### 8.3 实际场景中的大小分布

Tape Entry 的 payload 通常是结构化的 JSON（事实、偏好、摘要文本），很少超过几 KB。唯一可能超标的场景：

- compact 产生的 Anchor 包含大量累积状态（上百条记忆的聚合）
- 带有长文本引用的 Entry（如"用户发来的需求文档全文"）

前者通过 compact 策略本身控制粒度（每 200 条压缩一次，Anchor 不会无限膨胀）；后者在 record 时就应该只存摘要，不存原文。

## 9. Compaction 策略

### 9.1 触发条件

两个 Anchor 之间的 Entry 数超过 **200 条** 时触发。

参考依据：当前系统中，`Conversation.messageCount` 的典型值在几十到几百条之间（微信短对话场景）。200 条 Entry 意味着 Agent 已经从大约 100 轮对话中提取了结构化记忆，此时做一次压缩合理。

### 9.2 执行时机

Compaction 是**同步操作**，在 `withConversationLock()` 内、`chat()` 返回之前完成。这保证了：

- compact 过程中不会有新 Entry 写入（同一 Branch 的写入串行化）
- 下一次 recall 立即能看到 compact 后的状态

代价是 compact 那一次请求的延迟会增加几十毫秒。但 compact 是低频操作（每 200 条 Entry 触发一次），且 compact 本身只涉及一次 `$transaction`（一个 INSERT + 一个 UPDATE），远比一次 LLM 调用快。

### 9.3 旧 Entry 的生命周期

```
record → ... → compact触发 → 标记 compacted=true → 30天后物理删除
```

- 软删除后保留 30 天，与现有的 `Trace` 保留策略对齐（`observabilityService.cleanupExpired()` 已有定时清理机制，normal trace 7 天、flagged trace 30 天）
- 主查询路径（recall）跳过 `compacted = true` 的 Entry，不影响读取性能
- 物理删除可以复用现有的 12 小时定时清理任务：

```typescript
// packages/server/src/index.ts 中已有的定时清理
setInterval(() => observabilityService.cleanupExpired(), 12 * 60 * 60 * 1000);

// 扩展为同时清理过期的 Tape Entry
setInterval(async () => {
  await observabilityService.cleanupExpired();
  await tapeService.purgeCompacted(30);  // 删除 30 天前标记为 compacted 的 Entry
}, 12 * 60 * 60 * 1000);
```

## 10. 语义检索（可选，Phase 2）

> tape.systems 规范中，语义检索属于 **Views are projections** 的范畴——它是 Tape 的只读投影，不是真理来源。

### 10.1 不在 MVP 中

语义检索是**只读投影**，不是真理来源，不在主路径上。Agent 的核心操作（record → recall → compact）完全不依赖它。

### 10.2 引入条件

**当单个 Branch 的 Entry 总数超过 1000 条时**考虑引入。在此之前，用 PostgreSQL 的全文检索足够应对 flashback 场景：

```sql
-- 在 payload 中搜索关键词
SELECT * FROM tape_entries
WHERE account_id = $1
  AND branch = $2
  AND compacted = false
  AND payload::text ILIKE '%关键词%'
ORDER BY created_at DESC
LIMIT 10;
```

如果需要更精确的全文检索，可以在 `TapeEntry` 上添加 `tsvector` 列：

```prisma
// 需要用 raw SQL migration 添加
// ALTER TABLE tape_entries ADD COLUMN search_vector tsvector
//   GENERATED ALWAYS AS (to_tsvector('simple', coalesce(payload->>'text', ''))) STORED;
// CREATE INDEX idx_tape_search ON tape_entries USING gin(search_vector);
```

### 10.3 如果引入向量索引

- 构建异步进行，延迟几秒甚至几分钟都无所谓
- 检索到的 `eid` 必须回到 `tape_entries` 表验证时序关系和 `compacted` 状态
- 向量索引是 compact 后旧 Entry 物理删除的前置依赖——必须先从索引中移除，再从表中删除

## 11. 与 Observability 系统的集成

### 11.1 Tape 操作的 Span 追踪

项目已有完善的分布式追踪（`@clawbot/observability`），Tape 操作自然地融入现有 Span 树：

```
Trace (per request)
├─ message.receive
├─ command.dispatch
├─ conversation.lock
│  ├─ history.load
│  ├─ tape.recall              🆕 记录 recall 耗时、Entry 数量
│  ├─ agent.chat
│  │  ├─ llm.call (round 1)
│  │  ├─ tool.execute
│  │  └─ llm.call (round 2)
│  ├─ tape.record              🆕 记录写入的 Entry 数量、类别
│  └─ tape.compact             🆕 记录是否触发 compact、压缩的 Entry 数
└─ message.send
```

Span attributes 示例：

```typescript
await withSpan("tape.recall", {
  branch: conversationId,
  anchorAge: anchor?.createdAt,
  incrementalCount: incremental.length,
}, async () => { /* ... */ });

await withSpan("tape.compact", {
  triggered: entryCount >= threshold,
  compactedCount: entryCount,
}, async () => { /* ... */ });
```

### 11.2 Tape 相关的 Observability 指标

扩展现有的 metrics 体系（`@clawbot/observability/metrics`）：

| 指标 | 类型 | 标签 |
|---|---|---|
| `tape_recall_duration_ms` | Histogram | `branch_type` (session / global) |
| `tape_record_total` | Counter | `category`, `branch_type` |
| `tape_compact_total` | Counter | `branch_type` |
| `tape_entry_count` | Gauge | `account_id`, `branch_type`, `compacted` |

## 12. 方案对比

|  | 初始方案 | 当前方案（基于 tape.systems 规范） |
| --- | --- | --- |
| Entry 存储 | 独立 PostgreSQL | 复用现有 Supabase PG 实例 + Prisma |
| Entry 结构 | 简单 payload | 完整 meta（actor/source）+ Fragment 数组 + 可选 prevHash |
| Anchor 快照 | Redis / KV 数据库，和 Entry 同表 | 独立 `tape_anchors` 表，携带 manifest + predecessors DAG |
| 分支机制 | `/reset` 后新旧 Branch 零关联 | Handoff Anchor 携带精简状态，predecessors DAG 保持可追溯性 |
| Fold 语义 | 未定义 | 明确的 TapeState 类型 + category 级合并策略（last-write-wins / append） |
| 语义检索 | 向量库作为核心组件 | Phase 2 可选，先用 ILIKE / tsvector |
| 一致性保证 | 需要跨系统协调 | 单库事务（`prisma.$transaction`） |
| 并发策略 | 未明确 | 复用 `withConversationLock()`，单节点足够 |
| 大文件 | 未明确 | JSONB 内联（≤256KB）+ 复用 `MEDIA_CACHE_DIR` |
| Compaction | 未明确 | 同步 fold + 软删除 + manifest 可追溯 + 复用 12h 定时清理 |
| 可观测性 | 未明确 | 融入现有 Trace/Span 体系 |

## 13. 实施路径

### Phase 1 — 存储层 + 数据模型（本文档范围）

1. 新建 `packages/tape/` 独立包（纯数据层，不依赖 server/agent）
2. 在 `packages/tape/src/` 中实现 `types.ts`（TapeState/Fragment）、`fold.ts`（Reducer）、`service.ts`（record/recall/compact）、`queue.ts`（异步写入）
3. 在 `schema.prisma` 中添加 `TapeEntry` + `TapeAnchor` 模型
4. `packages/tape` 接受注入的 `PrismaClient` 实例，不自己管连接
5. 在 `packages/server/src/ai.ts` 的 `chat()` 中集成 recall + record 调用（注意：record 在 rollback 判断之后）
6. 扩展 `rotateSession()` 支持 handoff anchor 创建
7. 在定时清理任务中加入 `purgeCompacted()`

### Phase 2 — 记忆提取

- 设计 LLM 从对话中提取结构化记忆的策略（tool call or 后处理）
- 定义 `category` 枚举和 Fragment payload schema
- 实现 `extractMemories()` 函数
- 定义全局记忆 vs 会话记忆的提取策略（什么信息写 `__global__`，什么信息写会话 branch）

### Phase 3 — 语义检索

- 当 Entry 规模增长后，引入 tsvector 或外部向量索引
- 实现 flashback 查询接口

### 不在计划中

- Redis 缓存层 — 单库性能足够
- 多节点写入 — 当前单节点部署，不需要分布式锁
- 按 Branch 分区 — Entry 规模远未到需要分区的量级

## 14. 扩展路径

只有当真正跑到单库瓶颈（大量并发 Agent + 海量历史数据）时，才考虑：

1. 按 `accountId` 做分区表（PostgreSQL 原生分区）
2. 冷数据归档到对象存储（复用 Supabase Storage）
3. 引入独立的向量数据库
4. 从 `withConversationLock()` 升级到 PostgreSQL advisory lock（多节点部署时）

在此之前，一个 PostgreSQL 实例可以轻松支撑每秒数千条 Entry 的写入，对微信机器人的对话量来说已远超需求。
