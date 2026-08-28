# 事实账本 Phase 1：基础设施设计

> 状态：Approved for implementation planning
> 日期：2026-08-28
> 上游架构：[`docs/2026-08-28_00_15_agent-fact-ledger-and-context-rebuild-architecture.md`](../2026-08-28_00_15_agent-fact-ledger-and-context-rebuild-architecture.md)
> Phase 0 基线：[`docs/2026-08-28_10_30_fact-ledger-phase-0-business-baseline.md`](../2026-08-28_10_30_fact-ledger-phase-0-business-baseline.md)

## 1. 目标

Phase 1 建立可调用、可测试、尚未接入生产读写路径的事实账本基础设施：

- 独立的 Conversation Event、Agent Run Event、Memory Event Store；
- 独立的三类 stream head，由数据库事务化分配权威序号；
- 全局内容寻址的 Artifact Revision Store；
- Agent Port 与 Server Prisma Adapter；
- append-only 数据库保护；
- 幂等追加、并发追加、严格 JSON 持久化和分页读取的业务测试；
- migration-first 的数据库变更。

Phase 1 完成后，Phase 2 可以直接把渠道入站事实写入 Conversation Event Store，而不需要重新设计存储边界。

## 2. 非目标

本阶段不包含：

- 微信 canonical ingress 和 metadata adapter；
- 对现有 `chat()`、`MessageStore`、Tape、Vision 或 Web API 的双写或读路径切换；
- Context Compiler；
- Agent Runner、Memory Extractor 和投递流程接入新 Store；
- Transactional Outbox；
- Projection 构建或重建；
- 旧 `messages.payload` 清洗、导入或回填；
- Artifact Blob 上传、下载和生命周期治理；
- 多租户隔离。本项目的 `Account` 是微信账号，不是 SaaS tenant。

## 3. 已确认决策

1. Conversation、Run、Memory 使用三张独立事件表，不使用万能事件表。
2. 三类事件各自使用独立 head 表，不共用包含类型字段的通用 head 表。
3. Artifact 不按微信账号隔离，按 `kind + schemaVersion + sha256` 全局去重。
4. 同一幂等键重复追加：内容一致返回已有事件；内容不一致抛出明确冲突错误；重复请求不消耗序号。
5. 事件表和 Artifact 表使用 PostgreSQL Trigger 拒绝普通 `UPDATE`、`DELETE`。
6. 所有持久化 JSON 字段必须通过 `JsonValue` 契约，不能继续使用不保证可序列化的 `unknown`。
7. Store 在事务内分配序号和 `recordedAt`；调用方负责提供稳定的 `eventId`、业务发生时间和业务字段。
8. Phase 1 建设完整基础设施，但不切换任何现有业务行为。

## 4. 方案选择

### 4.1 采用：完整基础设施层

一次完成三类 Store、Artifact、Ports、Prisma Adapters、migration 和测试。这样 Phase 1 本身有完整验收边界，Phase 2 只负责渠道映射和双写。

### 4.2 未采用：仅数据库与 Server Store

如果不在 `@clawbot/agent` 定义 Port，Prisma 类型会暂时成为事实契约，Phase 2 还需再次调整依赖边界。

### 4.3 未采用：按事实流逐个实现

逐个实现会产生多个半完成状态，并重复设计事务、错误、分页和测试模式。三类 Store 的业务内容不同，但基础设施模式足够一致，适合在一个 Phase 内完成。

## 5. 分层与组件

### 5.1 `@clawbot/agent`：契约与 Ports

新增：

```text
packages/agent/src/ports/conversation-event-store.ts
packages/agent/src/ports/agent-run-store.ts
packages/agent/src/ports/memory-event-store.ts
packages/agent/src/ports/artifact-revision-store.ts
```

修改：

```text
packages/agent/src/shared/fact-ledger/contracts.ts
packages/agent/src/shared/fact-ledger/canonical-json.ts
packages/agent/src/shared/fact-ledger/index.ts
packages/agent/src/ports/index.ts
packages/agent/src/index.ts
```

职责：

- `shared/fact-ledger` 拥有领域契约、Append Input、分页参数和领域错误；
- `ports` 只定义能力接口和现有项目风格的 Port Slot；
- Port 只依赖 L0 `shared`，不依赖 Server、Prisma、HTTP 或渠道协议；
- 不在 Port 中暴露 Prisma `JsonValue`、`BigInt` 或数据库行类型。

Phase 1 在 Server 启动时注册四个 Prisma Adapter，但没有生产消费者调用它们。

### 5.2 `@clawbot/server`：Prisma Adapters

新增：

```text
packages/server/src/db/fact-ledger/codec.ts
packages/server/src/db/fact-ledger/errors.ts
packages/server/src/db/conversation-event-store.impl.ts
packages/server/src/db/agent-run-store.impl.ts
packages/server/src/db/memory-event-store.impl.ts
packages/server/src/db/artifact-revision-store.impl.ts
```

职责：

- Append Input 进入数据库前再次通过 Agent 契约校验；
- 使用 Prisma interactive transaction 原子分配序号并插入事件；
- 数据库行转换为领域 Event 后再次调用严格解析器；
- Prisma `JsonNull`、`DbNull` 等数据库细节只存在于 Server Adapter；
- Prisma P2002 等错误转换为领域错误，不能泄漏给 Agent；
- 不复用当前 `MessageStore`、Tape Store、Asset Store 或异步写队列。

`codec.ts` 只负责数据库行与领域对象转换；`errors.ts` 负责 Prisma 错误识别。确定性 JSON 规范化和 SHA-256 属于 Artifact 内容身份契约，实现在 Agent 的 `canonical-json.ts`，Server 直接复用，不能维护第二套 hash 算法。Store 类保留事务和查询编排，不堆积转换细节。

### 5.3 不新增事实账本 Service 单例

Phase 1 不新增高于 Port 的业务 Service。调用方在后续阶段通过 Port 获取 Store。这样不会在尚无消费者时创造第二套编排层。

## 6. 契约修正

### 6.1 JSON 持久化边界

以下字段从 `unknown` 收紧为 `JsonValue` 或对应的 JSON object：

- `MemoryEvent.payload.value`；
- `ArtifactRevision.inlineJson`；
- `ArtifactRevision.encryptionMetadata`；
- `ContextManifest.trimDecision`；
- 其他最终落入 `jsonb` 的开放字段。

必须拒绝：

- `undefined`；
- `bigint`；
- `symbol`、函数和类实例；
- `NaN`、`Infinity`；
- 循环引用；
- 对象属性中的非 JSON 值。

JSON object key 顺序不影响语义比较和内容 hash；数组顺序保持不变。Canonical representation 遵循 RFC 8785 JSON Canonicalization Scheme（JCS），由项目内单一实现固定。

### 6.2 Append Input 与持久化 Event 分离

新增：

```ts
type AppendConversationEventInput = Omit<
  ConversationEvent,
  "streamSeq" | "recordedAt"
>;

type AppendAgentRunEventInput = Omit<
  AgentRunEvent,
  "runSeq" | "recordedAt"
>;

type AppendMemoryEventInput = Omit<
  MemoryEvent,
  "memorySeq" | "recordedAt"
>;

type PutArtifactRevisionInput = Omit<ArtifactRevision, "createdAt">;
```

实际实现使用 distributive omit，保留判别联合的 payload 类型。Append Zod schema 从已持久化 Event 的各个 variant 派生，不能复制一份 payload schema，避免两份契约漂移。

调用方继续提供：

- 稳定的 `eventId`；
- `schemaVersion`；
- `occurredAt`，Conversation Event 还提供 `receivedAt`；
- actor、causation、correlation、idempotency 和 payload。

Store 负责：

- `streamSeq/runSeq/memorySeq`；
- `recordedAt`；
- Artifact 的 `createdAt`。

`recordedAt/createdAt` 使用数据库 `CURRENT_TIMESTAMP`，不使用应用进程时钟。

### 6.3 ID 语义

所有领域 ID 保持非空 `string`，数据库使用 `TEXT`，不强制 UUID：

- 允许未来使用 UUIDv7、ULID 或带前缀的稳定 ID；
- Store 不替调用方生成 ID；
- 调用方重试时必须复用同一个 Event ID；
- 即使调用方未复用 Event ID，Conversation Event 的平台幂等键仍能阻止重复事实。

## 7. Port API

### 7.1 通用返回结果

```ts
interface AppendResult<T> {
  value: T;
  appended: boolean;
}
```

`appended: false` 表示请求与已有事实语义一致。Phase 2 必须据此避免重复启动 run。

### 7.2 Conversation Event Store

```ts
interface ConversationEventStore {
  append(input: AppendConversationEventInput): Promise<AppendResult<ConversationEvent>>;
  getById(eventId: string): Promise<ConversationEvent | null>;
  listStream(input: {
    accountId: string;
    streamId: string;
    afterSeq?: number;
    throughSeq?: number;
    limit: number;
  }): Promise<ConversationEvent[]>;
}
```

读取顺序固定为 `streamSeq ASC`。`limit` 必须为 `1..500`。`afterSeq` 为 exclusive，`throughSeq` 为 inclusive。

### 7.3 Agent Run Store

```ts
interface AgentRunStore {
  append(input: AppendAgentRunEventInput): Promise<AppendResult<AgentRunEvent>>;
  getById(eventId: string): Promise<AgentRunEvent | null>;
  listRun(input: {
    runId: string;
    afterSeq?: number;
    throughSeq?: number;
    limit: number;
  }): Promise<AgentRunEvent[]>;
}
```

### 7.4 Memory Event Store

```ts
interface MemoryEventStore {
  append(input: AppendMemoryEventInput): Promise<AppendResult<MemoryEvent>>;
  getById(eventId: string): Promise<MemoryEvent | null>;
  listBranch(input: {
    accountId: string;
    branch: string;
    afterSeq?: number;
    throughSeq?: number;
    limit: number;
  }): Promise<MemoryEvent[]>;
}
```

### 7.5 Artifact Revision Store

```ts
interface ArtifactRevisionStore {
  put(input: PutArtifactRevisionInput): Promise<AppendResult<ArtifactRevision>>;
  getById(artifactId: string): Promise<ArtifactRevision | null>;
  getByContent(input: {
    kind: ArtifactKind;
    schemaVersion: number;
    sha256: string;
  }): Promise<ArtifactRevision | null>;
}
```

Artifact 不提供 list-all API，避免在尚无明确业务需求时引入大范围扫描接口。

## 8. 领域错误

新增稳定错误类型：

```text
FactLedgerIdConflictError
FactLedgerIdempotencyConflictError
FactLedgerContentHashMismatchError
FactLedgerCorruptionError
FactLedgerSequenceOverflowError
```

同时导出由 `ARTIFACT_KIND` 推导的 `ArtifactKind` 类型，避免 Port 手写重复 union。

语义：

- `FactLedgerIdConflictError`：同一 Event/Artifact ID 对应不同内容；
- `FactLedgerIdempotencyConflictError`：同一 Conversation 幂等键对应不同业务事实；
- `FactLedgerContentHashMismatchError`：inline Artifact 的 canonical JSON 实际 hash 与声明值不同；
- `FactLedgerCorruptionError`：当前 schema version 的数据库行无法通过对应结构校验；
- `FactLedgerSequenceOverflowError`：head 已达到 PostgreSQL `INTEGER` 的最大值。

错误消息不得包含完整 payload、用户正文、Artifact 内容或 encryption metadata。错误可以携带 ID、流身份和冲突类型等非内容诊断字段。

读取边界先检查 schema version：高于或不同于当前版本时原样抛出 Phase 0 的 `UnsupportedFactLedgerSchemaVersionError`；只有 schema version 是当前版本但字段、payload 或约束不合法时，Adapter 才包装为 `FactLedgerCorruptionError`。禁止把未来版本误报为数据损坏。

## 9. 数据库模型

所有序号使用 PostgreSQL `INTEGER` 并约束为正数，与当前 TypeScript `number` 契约一致。head 初始值为 0，第一次 append 返回 1。

### 9.1 Conversation Stream Head

```text
conversation_stream_heads
  account_id       TEXT        NOT NULL
  stream_id        TEXT        NOT NULL
  last_seq         INTEGER     NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  PRIMARY KEY (account_id, stream_id)
```

### 9.2 Conversation Event

```text
conversation_events
  event_id         TEXT        PRIMARY KEY
  account_id       TEXT        NOT NULL
  stream_id        TEXT        NOT NULL
  stream_seq       INTEGER     NOT NULL CHECK (stream_seq > 0)
  event_type       TEXT        NOT NULL
  schema_version   INTEGER     NOT NULL CHECK (schema_version > 0)
  occurred_at      TIMESTAMPTZ NOT NULL
  received_at      TIMESTAMPTZ NOT NULL
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  actor_kind       TEXT        NOT NULL CHECK (actor_kind IN ('user','agent','system'))
  actor_id         TEXT
  causation_id     TEXT
  correlation_id   TEXT
  idempotency_key  TEXT
  payload          JSONB       NOT NULL
```

约束与索引：

- `UNIQUE(account_id, stream_id, stream_seq)`；
- partial unique：`UNIQUE(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL`；
- 数据库显式增加 `CHECK (actor_kind = 'system' OR actor_id IS NOT NULL)`，确保 user/agent actor 必须有 `actor_id`；
- `(account_id, stream_id, stream_seq)` 顺序读取索引由 unique index 覆盖；
- `causation_id`、`correlation_id` 单独建立非唯一索引；
- `event_type, occurred_at` 不在 Phase 1 建索引，当前无对应读取 API。

### 9.3 Agent Run Head

```text
agent_run_heads
  run_id                 TEXT        PRIMARY KEY
  account_id             TEXT        NOT NULL
  conversation_stream_id TEXT        NOT NULL
  last_seq               INTEGER     NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

同一个 `runId` 首次 append 后不能绑定到其他账号或 conversation stream。Run head 的 conflict update 条件必须同时匹配已有 `account_id` 和 `conversation_stream_id`，不能只检查序号上限。

### 9.4 Agent Run Event

```text
agent_run_events
  event_id               TEXT        PRIMARY KEY
  run_id                 TEXT        NOT NULL
  run_seq                INTEGER     NOT NULL CHECK (run_seq > 0)
  account_id             TEXT        NOT NULL
  conversation_stream_id TEXT        NOT NULL
  event_type             TEXT        NOT NULL
  schema_version         INTEGER     NOT NULL CHECK (schema_version > 0)
  occurred_at            TIMESTAMPTZ NOT NULL
  recorded_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  causation_id           TEXT
  correlation_id         TEXT
  payload                JSONB       NOT NULL
```

约束与索引：

- `UNIQUE(run_id, run_seq)`；
- `run_id` 引用 head，删除策略为 `RESTRICT`；
- `account_id, conversation_stream_id, recorded_at` 建审计查询索引；
- `causation_id`、`correlation_id` 建非唯一索引。

### 9.5 Memory Stream Head

```text
memory_stream_heads
  account_id       TEXT        NOT NULL
  branch           TEXT        NOT NULL
  last_seq         INTEGER     NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  PRIMARY KEY (account_id, branch)
```

### 9.6 Memory Event

```text
memory_events
  event_id         TEXT        PRIMARY KEY
  account_id       TEXT        NOT NULL
  branch           TEXT        NOT NULL
  memory_seq       INTEGER     NOT NULL CHECK (memory_seq > 0)
  event_type       TEXT        NOT NULL
  schema_version   INTEGER     NOT NULL CHECK (schema_version > 0)
  occurred_at      TIMESTAMPTZ NOT NULL
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  actor_kind       TEXT        NOT NULL CHECK (actor_kind IN ('user','agent','system'))
  actor_id         TEXT
  causation_id     TEXT
  correlation_id   TEXT
  payload          JSONB       NOT NULL
```

约束与索引：

- `UNIQUE(account_id, branch, memory_seq)`；
- 与 Conversation Event 相同，数据库显式增加 `CHECK (actor_kind = 'system' OR actor_id IS NOT NULL)`；
- `causation_id`、`correlation_id` 建非唯一索引。

### 9.7 Artifact Revision

```text
artifact_revisions
  artifact_id          TEXT        PRIMARY KEY
  kind                 TEXT        NOT NULL
  sha256               TEXT        NOT NULL
  schema_version       INTEGER     NOT NULL CHECK (schema_version > 0)
  inline_json          JSONB
  storage_ref          JSONB
  encryption_metadata  JSONB
  created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
```

约束与索引：

- `UNIQUE(kind, schema_version, sha256)`；
- `sha256` 检查 `^[a-f0-9]{64}$`；
- `num_nonnulls(inline_json, storage_ref) = 1`；
- `storage_ref` 的对象形态由 Agent 契约校验；
- Artifact 不包含 `account_id`；使用关系由 Event 和 Manifest 引用表达。

### 9.8 Account 关系

Conversation、Run、Memory head 和 event 的 `account_id` 引用 `accounts.id`，使用 `ON DELETE RESTRICT`：

- Phase 1 没有新事实写入，因此不改变当前账号删除行为；
- Phase 2 开始写事实后，账号不能通过级联删除静默抹除账本；
- 后续隐私删除需要独立设计 tombstone、Artifact 生命周期或密钥销毁。

Artifact 没有 Account 外键。

## 10. 事务与序号分配

每次新 append 使用单个 Prisma interactive transaction：

1. 校验 Append Input；
2. 查询 Event ID 或幂等键是否已存在；
3. 如果是等价重复，返回 `{ appended: false }`；
4. 如果冲突，抛领域错误；
5. 使用参数化 SQL 执行 `INSERT ... ON CONFLICT ... DO UPDATE`，设置 `last_seq = last_seq + 1, updated_at = CURRENT_TIMESTAMP`，并在更新条件中要求 `last_seq < 2147483647`；
6. Run head 的更新条件额外要求 `account_id = EXCLUDED.account_id AND conversation_stream_id = EXCLUDED.conversation_stream_id`；`RETURNING` 无结果时在同一事务读取 head，身份不一致抛 `FactLedgerIdConflictError`，否则抛 `FactLedgerSequenceOverflowError`；
7. 插入事件，省略 `recordedAt` 让数据库填充；
8. 将返回行解析成严格领域 Event；
9. 提交事务。

Run head 使用以下等价条件，实施时必须保留全部谓词：

```sql
ON CONFLICT (run_id) DO UPDATE
SET last_seq = agent_run_heads.last_seq + 1,
    updated_at = CURRENT_TIMESTAMP
WHERE agent_run_heads.last_seq < 2147483647
  AND agent_run_heads.account_id = EXCLUDED.account_id
  AND agent_run_heads.conversation_stream_id = EXCLUDED.conversation_stream_id
RETURNING last_seq;
```

Conversation 与 Memory head 同样在 conflict update 时刷新 `updated_at`，其流身份已经完整包含在复合主键中。

若两个并发请求在步骤 2 都未发现记录：

- head 行的原子 upsert 会串行分配序号；
- 后写事务若触发 Event ID 或幂等唯一键冲突，整个事务回滚，包括 head 增量；
- Adapter 捕获唯一键错误后重新读取胜出记录；
- 内容一致返回 `appended: false`，不一致抛冲突；
- 不产生重复事件和序号空洞。

禁止使用：

- 进程内 `nextSeq()`；
- `SELECT MAX(seq) + 1`；
- 事务外先更新 head 再写事件；
- 异步 fire-and-forget 写队列。

## 11. 幂等与等价比较

### 11.1 Event ID 重试

同一 `eventId`：

- Conversation Event 比较时排除数据库分配字段和 `receivedAt`；Run/Memory 只排除数据库分配字段；
- 其余字段完全等价时返回第一次保存的事件，第一次 `receivedAt` 保持权威；
- 其余任一字段不同抛 `FactLedgerIdConflictError`。

`receivedAt` 表示本地接收尝试时间，稳定 Event ID 的重投可能产生新的接收时间，因此不应把它当成逻辑事件身份。`idempotencyKey` 仍参与 Event ID 比较。

### 11.2 Conversation 平台幂等键

同一 `(accountId, idempotencyKey)`：

等价比较包含：

- account、stream、event type、schema version；
- occurredAt；
- actor；
- causation/correlation；
- payload。

等价比较排除：

- `eventId`，允许重投时重新构造本地 ID；
- `receivedAt`，平台重投可能在另一次本地接收时到达；
- `recordedAt`、`streamSeq`。

内容一致返回第一次记录的 Event，因此第一次 `receivedAt` 保持权威；内容不同抛 `FactLedgerIdempotencyConflictError`。

### 11.3 Run 与 Memory

Run 和 Memory v1 没有独立幂等键，只通过稳定 `eventId` 实现安全重试。Phase 4/5 接入时，如果业务证明需要额外键，再通过新 schema version 增加，Phase 1 不预留无语义字段。

### 11.4 JSON 比较

使用 RFC 8785 JCS canonical JSON：

- object key 按 UTF-16 code unit 顺序排列；
- array 保持原顺序；
- string 使用 JCS/ECMAScript JSON escaping，并拒绝 lone surrogate；
- number 必须有限，按 ECMAScript 最短 round-trip 形式编码，`-0` 规范化为 `0`；
- canonical bytes 固定为 UTF-8；
- 比较 canonical representation，而不是 `JSON.stringify` 的原始属性插入顺序。

## 12. Artifact 内容寻址

### 12.1 Inline Artifact

Store 对 `inlineJson` 的 JCS UTF-8 bytes 计算 SHA-256：

- 与输入 `sha256` 不同则拒绝；
- 内容键已存在时返回已有 Artifact 和 `appended: false`；
- 同一 `artifactId` 指向不同内容键，抛 ID 冲突。

SHA-256 是内容身份；Store 不尝试处理理论上的 SHA-256 碰撞。

### 12.2 External Artifact

Phase 1 不读取外部 Blob：

- 调用方负责在 put 前完成 Blob 写入和 hash 计算；
- Store 校验 `storageRef` 信封和 SHA 格式；
- 相同内容键但 `storageRef` 不同，返回第一次保存的 Artifact，不视为冲突，因为内容身份由 hash 决定；
- 相同 `artifactId` 但内容键不同仍然冲突。

这允许将来迁移 Blob 位置而不改变内容身份，但 Artifact Revision 本身仍不 UPDATE；新位置治理需要单独的 Artifact location 机制，不在 Phase 1 设计。

### 12.3 全局共享

Artifact 不按微信账号复制。相同 Skill、Prompt、Tool schema 或其他内容在所有账号间共享同一 revision。Account、Run 和 Event 通过 Artifact ID 表达使用关系。

## 13. Append-only 数据库保护

migration 创建统一 Trigger function：

```text
reject_fact_ledger_mutation()
```

挂载到：

- `conversation_events`；
- `agent_run_events`；
- `memory_events`；
- `artifact_revisions`。

对 `BEFORE UPDATE OR DELETE` 直接抛异常。head 表不挂 Trigger，因为序号分配必须更新。

Store API 不暴露 update/delete。更正使用新事件；Artifact 变化创建新 revision。

Phase 1 不提供运行时 bypass。未来 retention 或合规清理必须通过独立 migration/维护流程完成并留下运维审计，不能把通用 bypass 暴露给应用连接。

## 14. 读取与分页

- 所有流读取只使用权威序号排序；
- cursor 使用数字序号，不使用数据库内部 ID 或时间；
- `afterSeq` exclusive，便于增量重放；
- `throughSeq` inclusive，便于固定历史游标；
- `limit` 调用方必填并限制为 `1..500`；
- 空结果返回 `[]`；
- `getById` 找不到返回 `null`；
- 读取先执行版本判断：未知版本抛 `UnsupportedFactLedgerSchemaVersionError`；当前版本结构损坏才抛 `FactLedgerCorruptionError`；
- 两类解析失败都禁止跳过坏行后继续返回不完整事实。

Phase 1 不提供按时间、event type、correlation 扫描的 Port API。数据库保留必要因果索引，等审计页面有明确查询需求时再扩展。

## 15. Migration 策略

### 15.1 Schema 流程

1. 修改 `packages/server/prisma/schema.prisma`；
2. 使用 `prisma:migrate:diff` 生成候选 SQL；
3. 人工删除与本 Phase 无关的差异；
4. 人工补充 Prisma schema 无法表达的 partial unique index、JSON/XOR check 和 append-only trigger；
5. 保存到 `packages/server/prisma/migrations/20260828120000_add_fact_ledger_phase_1/migration.sql`；
6. 确认 SQL 只创建新对象，不修改现有业务表数据；
7. 执行 `prisma:migrate:deploy`；
8. 执行 `prisma:generate`；
9. 执行 `prisma:migrate:status` 和 `prisma:validate`。

migration SQL 使用显式事务，任一步失败时不留下部分表、索引或 Trigger。

### 15.2 无数据迁移

Phase 1 不从 `messages`、Tape、Trace、Asset 或现有配置回填任何数据。新表部署后为空。

### 15.3 兼容部署顺序

采用 expand-only：

1. 先部署 migration；
2. 再部署包含新 Prisma Client 和未被生产调用的 Store 代码；
3. 旧版本应用完全忽略新表；
4. 新版本应用仍使用旧业务路径。

因此 Phase 1 不需要 feature flag，也不需要双写开关。

## 16. 测试设计

### 16.1 Agent 契约测试

修改或新增 `packages/agent/test/fact-ledger/` 测试：

- 所有持久化 JSON 字段接受完整 JSON 值；
- 拒绝 `undefined`、BigInt、NaN、Infinity、函数和循环引用；
- Append Input 不接受数据库分配字段；
- Persisted Event 仍要求 seq 和 `recordedAt`；
- Append schema 与所有 Event variant 保持一一对应；
- 未知 schema version 继续显式失败；
- 新领域错误不包含 payload 内容。

### 16.2 Server 纯单元测试

新增 `packages/server/src/db/fact-ledger/*.test.ts`：

- Prisma row 到领域 Event 的时间、JSON 和 nullable 字段转换；
- inline Artifact SHA 校验；
- Conversation Event ID 等价比较排除 `receivedAt`，但仍包含 `idempotencyKey` 和其他业务字段；
- idempotency 比较排除 eventId/receivedAt，但包含业务事实字段；
- Run head 拒绝同一 `runId` 改绑 account 或 conversation stream；
- P2002 转领域冲突，不泄漏 Prisma 错误；
- 未知版本抛 `UnsupportedFactLedgerSchemaVersionError`，当前版本坏行抛 corruption error，均不静默跳过。

Agent 的 `canonical-json.test.ts` 覆盖对象 key 顺序、数组顺序、数字规范化、Unicode 边界和 SHA-256 稳定性。

### 16.3 数据库集成测试

增加以下显式入口：

```json
"test:fact-ledger-db": "tsx --conditions development --test 'test-integration/fact-ledger-stores.test.ts'"
```

测试只接受 `FACT_LEDGER_TEST_DATABASE_URL` 指向名称以 `_fact_ledger_test` 结尾的 disposable PostgreSQL。未提供专用 URL 或数据库名不符合保护规则时直接失败；它不读取开发用 `DATABASE_URL` 作为回退。

覆盖：

1. 50 个并发 Conversation append 得到连续且唯一的 `1..50`；
2. Run 和 Memory 各自按流独立分配序号；
3. 同一 `runId` 改绑 account 或 conversation stream 会失败且不消耗序号；
4. 不同流可以并发追加，互不阻塞逻辑结果；
5. 同一幂等键并发写入只产生一条事件；
6. 幂等冲突抛领域错误；
7. 失败插入会回滚 head 增量；
8. UPDATE/DELETE 四张不可变表被 Trigger 拒绝；
9. head 表可以正常更新，成功追加会刷新 `updated_at`；
10. Artifact 全局内容去重；
11. 分页的 after/through 边界准确；
12. recordedAt/createdAt 来自数据库；
13. Account 删除在已有事实时被 RESTRICT。

测试数据库必须可整体丢弃。由于 append-only Trigger 有意阻止逐行清理，测试结束不尝试 delete fixtures。

### 16.4 生产路径回归

必须继续通过：

- `pnpm -F @clawbot/agent lint:layers`；
- `pnpm -F @clawbot/agent typecheck`；
- `pnpm -F @clawbot/server exec tsc --noEmit`；
- `pnpm test:agent`；
- `pnpm test:server`；
- `pnpm -F @clawbot/weixin-agent-sdk test`；
- Phase 0 characterization tests。

## 17. 文件级实施范围

### Agent

```text
M packages/agent/src/shared/fact-ledger/contracts.ts
A packages/agent/src/shared/fact-ledger/canonical-json.ts
M packages/agent/src/shared/fact-ledger/index.ts
A packages/agent/src/ports/conversation-event-store.ts
A packages/agent/src/ports/agent-run-store.ts
A packages/agent/src/ports/memory-event-store.ts
A packages/agent/src/ports/artifact-revision-store.ts
M packages/agent/src/ports/index.ts
M packages/agent/src/index.ts
M packages/agent/test/fact-ledger/contracts.test.ts
A packages/agent/test/fact-ledger/append-contracts.test.ts
A packages/agent/test/fact-ledger/canonical-json.test.ts
```

### Server

```text
M packages/server/prisma/schema.prisma
A packages/server/prisma/migrations/20260828120000_add_fact_ledger_phase_1/migration.sql
A packages/server/src/db/fact-ledger/codec.ts
A packages/server/src/db/fact-ledger/errors.ts
A packages/server/src/db/fact-ledger/codec.test.ts
A packages/server/src/db/conversation-event-store.impl.ts
A packages/server/src/db/conversation-event-store.impl.test.ts
A packages/server/src/db/agent-run-store.impl.ts
A packages/server/src/db/agent-run-store.impl.test.ts
A packages/server/src/db/memory-event-store.impl.ts
A packages/server/src/db/memory-event-store.impl.test.ts
A packages/server/src/db/artifact-revision-store.impl.ts
A packages/server/src/db/artifact-revision-store.impl.test.ts
A packages/server/test-integration/fact-ledger-stores.test.ts
A packages/server/test-integration/tsconfig.json
M packages/server/src/ai.ts
M packages/server/package.json
```

本设计不新增 npm 依赖，集成测试复用现有 Prisma Client 和 Prisma CLI，因此不应修改 lockfile，也不引入数据库容器运行时依赖。

## 18. 实施顺序

1. 收紧 JSON 契约并增加 Append Input/错误类型；
2. 增加四个 Agent Port 和 exports；
3. 增加 Prisma models；
4. 生成并人工审查 migration；
5. 部署 migration、生成 Prisma Client；
6. 实现 Agent canonical JSON 与 Server codecs；
7. 实现 Conversation Store 及幂等逻辑；
8. 复用稳定模式实现 Run、Memory Store；
9. 实现 Artifact Store；
10. 注册 Port Adapter，但不增加消费者；
11. 完成单元与 disposable DB 集成测试；
12. 运行全量回归并检查生产路径没有新 Store 调用。

这里的“复用模式”指共享小型内部 helper，不创建一张通用 Store 或使用不透明泛型隐藏三类流的领域差异。

## 19. 可观测性与错误处理

Phase 1 Store 是同步持久化边界：

- append 失败直接 reject，由未来调用方决定是否重试；
- 不在 Store 内无限重试；
- 等价重复是正常结果，不记 error；
- 内容冲突记 warn，并只记录 ID、流和冲突类型；
- 数据损坏和数据库不可用记 error 后 rethrow；
- 不记录 payload、用户 text、Memory value、Artifact inline JSON 或 encryption metadata；
- Phase 1 不新增 metrics，等 Phase 2 有真实流量后再定义低基数指标。

## 20. 回滚条件与策略

### 20.1 停止实施条件

出现以下任一情况，不进入 Phase 2：

- 并发追加出现重复或不连续序号；
- 等价幂等重试仍消耗序号；
- append 失败后 head 未回滚；
- Trigger 可以被普通 Prisma update/delete 绕过；
- 任一数据库行不能稳定 round-trip 到领域契约；
- 新 Store 被现有聊天、微信、Tape 或 Web 路径调用；
- migration diff 包含删除、改写现有业务表或数据回填；
- 全量 Phase 0 characterization tests 不通过。

### 20.2 应用回滚

Phase 1 新表没有生产写入，应用可以直接回滚到旧版本。旧应用忽略新表，不要求同步回滚 migration。

### 20.3 数据库回滚

默认保留 expand-only 表，不执行 destructive rollback。只有确认尚未进入 Phase 2、所有事实表均为空时，才允许通过一条独立、人工审查的 migration 删除 Trigger、事件表和 head 表。

禁止在可能已有事实后自动 drop 或 truncate。

## 21. 验收标准

Phase 1 完成必须同时满足：

1. 三类 Store 和 Artifact Store 均可通过 Agent Port 调用；
2. 三类序号由数据库事务分配，单流严格递增；
3. Run head 不能被同一 `runId` 改绑 account 或 conversation stream；
4. 并发写入、事务失败和进程重试不产生重复事实或序号空洞；
5. Conversation 幂等键满足“一致返回旧值、冲突明确失败”；
6. Artifact 在全系统按内容键去重；
7. 所有 JSONB 输入均通过 JSON 契约；
8. 四张不可变表的 UPDATE/DELETE 被数据库拒绝；
9. 未知版本与当前版本损坏使用不同错误边界；
10. 所有读结果经过当前 schema 严格解析；
11. migration 只新增对象，不回填、不切换路径；
12. 现有业务可观察行为与 Phase 0 基线一致；
13. 文档、schema、migration、Port 和实现命名一致；
14. 工作区类型检查、分层检查和测试全部通过。

## 22. Phase 2 入口

Phase 1 验收后，Phase 2 只能通过 `ConversationEventStore.append()` 接入微信 canonical ingress，并以 `AppendResult.appended` 决定是否启动 run。

Phase 2 不得：

- 绕过 Adapter 直接写 Prisma Event model；
- 用进程内 seq 覆盖 Store 分配结果；
- 将渠道 metadata 展开进标准上下文字段；
- 因双写失败而静默继续，必须定义明确的一致性和降级策略。
