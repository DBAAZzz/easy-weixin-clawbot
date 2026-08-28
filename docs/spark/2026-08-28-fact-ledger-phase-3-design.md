# Fact Ledger Phase 3：Session Boundary 与 Context Compiler Shadow Mode

> 状态：CR2 修订完成 / 可进入实施
> 日期：2026-08-28  
> 前置：Phase 2 微信 ingress、dispatch receipt、legacy projection link 与 disposable PostgreSQL 集成测试已通过  
> 范围：补齐 `/clear` 的显式 session boundary，建立只读 Conversation Events 的确定性 Context Compiler，并与旧请求做隔离的 shadow diff；不切换模型读取路径

## 1. 决策摘要

Phase 3 采用以下方案：

1. 微信外部事实流继续保持 `streamId = senderId`，`/clear` 不创建新的外部 stream；
2. `/clear` 的 legacy projection clear、route 删除、receipt command 标记与 `session_rotated` append 在同一 PostgreSQL 事务完成；其在同一 stream 中的位置就是权威 session boundary；
3. Context Compiler 只显式读取 Conversation Event 的标准字段，不展开 `payload`，不读取 `channelMetadata`、dispatch receipt、projection link 或旧 `messages.payload`；
4. Phase 3 的 attachment resolver 只接受标准 `attachmentRefs`，缺少 immutable Artifact 映射时显式输出 `unresolved`，不读取 CDN、AES、本地路径或旧 Asset；
5. canonical context 只表达当前事实账本已经具备证据的内容。Phase 2 尚无完整 outbound/run facts，因此 Phase 3 不伪造 assistant/tool 历史；
6. shadow diff 可以读取旧链路快照作为“被比较对象”，但该数据必须通过隔离 adapter 进入 diff 模块，绝不能回流到 Compiler；
7. shadow 结果不发送给模型、不改变旧请求、不持久化正文，只记录 hash、计数和固定分类；
8. Phase 3 不进行生产读取切换。完整切换必须等待 Run Ledger、outbound facts、Context Manifest 和媒体 Artifact 边界落地。

## 2. 目标

Phase 3 完成后，系统具备下面的并行链路：

```text
Conversation Events through source event cursor
  -> apply latest session boundary
  -> apply edit/delete semantics
  -> explicitly project canonical fields
  -> resolve attachment refs (resolved | unresolved)
  -> build provider-independent Canonical Context V1
  -> build canonical Memory Extractor input
  -> canonical JSON + SHA-256

Legacy AgentMessage[] snapshot
  -> quarantined legacy normalizer
  -> structural diff only

Canonical + Legacy
  -> fixed-category shadow diff
  -> metrics / hash-only operational result
  -> never sent to model
```

必须满足：

1. `/clear` 不再依赖解析用户文本来推断 session boundary；
2. 编译结果由 `accountId + streamId + eventCursor + compilerVersion + policy + effectiveTime + timezone` 唯一决定；
3. 仅 `channelMetadata` 不同的事件产生完全相同的 canonical context、Memory Extractor input 和 hash；
4. Compiler 不读取 dispatch、projection link、旧 Message、微信 metadata 或本地媒体路径；
5. future event 不得越过 `eventCursor` 进入结果；
6. shadow 失败不影响现有模型调用、回复发送和 sync cursor；
7. shadow 不调用模型，不写 Context Manifest，不创建 Run Event；
8. 差异被分为稳定、低基数类别，而不是记录请求正文。

## 3. 非目标

Phase 3 不做：

- 将生产聊天历史切换为 Conversation Events；
- 发送 canonical shadow request 给任何模型；
- 完整 Agent Run Ledger；
- 持久化正式 Context Manifest；
- 固定 Prompt、Skill、Tool、Model revision；
- 从旧 Message 反向恢复 assistant/tool/outbound facts；
- 将 Phase 2 source attachment ref 冒充 immutable Artifact ID；
- Vision observation、媒体重放或 provider wire request；
- Tape 到 Memory Event 的迁移；
- Transactional Outbox 或 outbound delivery fact；
- Web UI、公开 HTTP API 或自动灰度切换；
- 删除或改写旧 `messages.payload`。

Phase 3 是读取边界和确定性编译器的验证阶段，不是读取源切换阶段。

## 4. 方案比较

### 4.1 方案 A：直接从 Conversation Events 生成完整旧式 AgentMessage[]

优点是看起来最接近现有 runner。缺点是 Phase 2 没有完整 assistant、tool、memory、vision 和 outbound facts，只能从旧 Message 补数据。这样 Compiler 会再次依赖 prompt-shaped payload，违反事实重建目标。

不采用。

### 4.2 方案 B：只编译当前用户文本

优点是实现简单，也容易保证 metadata 隔离。缺点是无法验证 cursor、session boundary、edit/delete、attachment 和多轮顺序，不能形成 Phase 4 可扩展的边界。

不采用。

### 4.3 方案 C：编译“证据完整度显式”的 Canonical Context V1，并隔离 shadow diff（采用）

Compiler 只输出当前事实账本可以证明的 entries，并在 coverage 中声明 Phase 3 是 `conversation-facts-only`。旧链路只进入独立 diff adapter，不补全 canonical 内容。

该方案允许现在验证最关键的读取边界，同时不会假装 Phase 2 已经具备完整重放能力。Phase 4、5、6 可以分别增加 run、memory、media 和 outbound source，而不改变 Phase 3 的纯 Conversation Event reducer。

## 5. Session boundary 语义

### 5.1 外部 stream 保持稳定

Phase 2 已固定微信 direct chat：

```text
accountId = 微信账号
streamId  = senderId
```

Phase 3 不改变这个含义。`/clear` 是同一外部事实流内的上下文边界，不是新的微信会话身份，也不创建新 `streamId`。

### 5.2 `/clear` 的权威事实

成功执行 `/clear` 后，追加：

```ts
{
  eventType: "session_rotated",
  schemaVersion: 1,
  accountId,
  streamId: sourceInboundEvent.streamId,
  occurredAt: sourceInboundEvent.occurredAt,
  receivedAt: sourceInboundEvent.receivedAt,
  actor: sourceInboundEvent.actor,
  causationId: sourceInboundEvent.eventId,
  correlationId: sourceInboundEvent.eventId,
  idempotencyKey: `session-boundary:v1:${sourceInboundEvent.eventId}`,
  payload: {
    previousStreamId: sourceInboundEvent.streamId,
    reason: "user_clear"
  }
}
```

`previousStreamId` 是 v1 历史兼容字段，不是路由依据。对微信稳定 stream，它记录 boundary 所属的前序外部 stream，值与当前 `streamId` 相同。Phase 3 必须同时在 fact-ledger contract 上补充该语义注释；Compiler 禁止读取它来寻找另一个 stream，只使用 boundary 的权威 `streamSeq`。

Event ID 跨进程稳定：

```text
session-boundary-v1:<sha256(accountId + NUL + sourceInboundEvent.eventId)>
```

时间复用 source event 的平台时间和接收时间，以保证 crash 后幂等重试不会因重新取时产生等价性冲突。事件只在 clear side effect 成功后追加，因此其存在表示边界已经生效。

### 5.3 SDK command lifecycle

SDK 不解析 Fact Ledger，但它已经拥有 `/clear` command 语义。Lifecycle 增加 clear 专用调用：

```ts
interface WeixinIngressLifecycle {
  // existing accept / invokeAgent / settle
  invokeClear(input: {
    receiptId: string;
    conversationId: string;
  }): Promise<void>;
}
```

启用 ledger 时，slash handler 的 `onClear` 必须调用 `lifecycle.invokeClear()`；未启用账号继续调用 `agent.clearSession()`。Server lifecycle 按下面顺序执行：

```text
validate processing receipt and source event
  -> resolve effective conversation
  -> acquire effective conversation lock
  -> wait for queued legacy message writes while holding lock
  -> one PostgreSQL transaction:
       mark receipt command_name=clear
       lock and tombstone legacy projection links
       delete legacy messages and reset conversation counters
       delete session route
       append deterministic session_rotated
  -> evict effective conversation from in-memory cache
  -> return to SDK
  -> SDK sends clear confirmation
  -> settle command receipt completed/failed
  -> SDK may persist sync cursor
```

事务使用 server 内部 clear service，不通过会自行开启事务的 `MessageStore.clearMessages()` 或 `ConversationEventStore.append()` 组合。Phase 3 把二者的 SQL/codec 核心抽成接受 Prisma transaction client 的内部 helper，public Store 方法继续自行开启事务。stream sequence 冲突或可重试事务错误只能重试整个 clear transaction，不能只重试 append 部分。事务失败时数据库中的 legacy history、route、receipt command marker 和 boundary 全部不变，因此不存在“legacy 已清空但 boundary 缺失”的可提交状态。

内存 cache 不属于数据库事务：事务前由 conversation lock 阻止并发 turn，事务提交后同步 `evict()`。进程若在 commit 后、evict 前崩溃，进程退出会自然丢弃 cache；若同步 evict 异常，则账号 runtime fail closed 并停止接收新 turn，禁止继续使用可能过期的内存历史。

这样即使确认消息发送失败，只要 clear transaction 已完成，boundary 仍然存在。确认发送失败时 receipt 可 settle failed，但未来上下文边界仍然正确。

`weixin_ingress_dispatches` 增加 nullable `command_name`，Phase 3 只允许值 `clear`。该字段与 clear/boundary 在同一事务写入，不保存用户原文或参数。

`/echo` 和 `/toggle-debug` 不调用 `invokeClear()`，也不产生 boundary。

### 5.4 Compiler 的 boundary 规则

对 `throughSeq = eventCursor` 的事件页：

1. 找到 `streamSeq <= eventCursor` 的最后一个 `session_rotated`；
2. 只把 `streamSeq > boundary.streamSeq` 的消息事实加入当前 session；
3. boundary 事件本身不成为模型可见 entry；
4. `/clear` 的 inbound command event 位于 boundary 之前，因此不进入新 session；
5. 没有 boundary 时，从 stream 第一条事件开始；
6. future boundary 和 future message 都不能越过 cursor。

Compiler 不读取 legacy effective conversation route 来应用边界。

## 6. Attachment source ref 边界

### 6.1 两种身份不得混用

Phase 2 `weixin-attachment-v1:*` 是渠道来源 attachment identity，不是 Asset ID，也不是 Artifact Revision ID。

Phase 3 定义：

```ts
interface CanonicalAttachment {
  sourceRef: string;
  resolution:
    | { status: "resolved"; artifactId: string; mimeType?: string }
    | { status: "unresolved"; reason: "artifact_mapping_missing" };
}
```

### 6.2 Resolver Port

```ts
interface AttachmentArtifactResolver {
  resolve(input: {
    accountId: string;
    sourceRefs: string[];
  }): Promise<Map<string, ResolvedAttachmentArtifact>>;
}
```

约束：

- 输入只能来自 Conversation Event 标准 `attachmentRefs`；
- resolver 不接收 channel metadata；
- 返回的 `artifactId` 必须通过 Artifact Revision Store 验证存在；
- 未映射时返回 unresolved，不猜测、不下载、不读取旧 Message；
- 输出顺序始终按事件 `attachmentRefs`，不能按 resolver Map 顺序；
- Phase 3 默认 resolver 没有映射，因此所有微信 attachment 都是显式 unresolved；
- Phase 5 增加 source-ref → immutable Artifact 映射时复用该 Port，不修改 Compiler。

Phase 3 不新增 source attachment mapping 表，避免把旧 mutable Asset 误标为 immutable Artifact。

## 7. Canonical Context V1

### 7.1 类型

```ts
interface CompileContextInputV1 {
  accountId: string;
  conversationStreamId: string;
  eventCursor: number;
  compilerVersion: "context-compiler-v1";
  contextPolicyRevisionId: "context-policy-v1";
  effectiveTime: string;
  timezone: "Asia/Shanghai";
}

interface CanonicalContextV1 {
  schemaVersion: 1;
  compilerVersion: "context-compiler-v1";
  contextPolicyRevisionId: "context-policy-v1";
  accountId: string;
  conversationStreamId: string;
  eventCursor: number;
  sessionBoundaryEventId?: string;
  entries: CanonicalConversationEntryV1[];
  runtimeContext: {
    effectiveTime: string;
    timezone: "Asia/Shanghai";
  };
  coverage: {
    conversationFacts: true;
    assistantRunFacts: false;
    toolRunFacts: false;
    memoryFacts: false;
    immutableMediaArtifacts: false;
  };
}

interface CanonicalConversationEntryV1 {
  eventId: string;
  streamSeq: number;
  role: "user" | "assistant";
  occurredAt: string;
  text: string;
  attachments: CanonicalAttachment[];
  replyToEventId?: string;
}
```

`runtimeContext` 是 request-local 编译输入，不写回 Conversation Event。Phase 3 使用 server 在 run 开始时一次性捕获的 `effectiveTime`；同一次 legacy 与 shadow 对比必须使用同一个值。

完整编译输入身份明确为：

```text
accountId + streamId + eventCursor + compilerVersion + contextPolicyRevisionId
+ effectiveTime + timezone
```

缓存键、shadow 对账和未来历史重放都必须包含这些动态输入。不能只用 facts cursor 复用包含不同 effective time 的 hash。Phase 3 的 policy 先固定为 revision 常量 `context-policy-v1`，而不是未版本化对象。

### 7.2 允许读取的事件字段

Compiler 使用逐事件显式 switch，禁止通用 spread：

- envelope：`eventId`、`streamSeq`、`eventType`、`occurredAt`、`actor`；
- inbound received：`text`、`attachmentRefs`、`replyToEventId`；
- inbound edited：`targetEventId`、`text`、`attachmentRefs`；
- inbound deleted：`targetEventId`；
- outbound delivered：`text`、`attachmentRefs`；
- session rotated：只使用事件位置作为 boundary。

以下字段禁止读取：

- `channelMetadata` 及其 `data`；
- `channel`、`channelMessageId`、`senderSnapshot`，除非未来单独成为模型标准字段；
- dispatch receipt；
- legacy projection link；
- `messages.payload`；
- context token、CDN URL、AES key、本地路径；
- Trace payload。

### 7.3 Edit / delete reducer

即使微信 Phase 3 不产生 edit/delete，Compiler 仍实现通用契约：

- edit 仅修改同一编译窗口内目标 message 的 `text` 与 attachments；
- delete 从 canonical entries 移除目标 message；
- edit/delete 指向不存在、已跨 session boundary 或 future 的目标时记录固定 diagnostic，不猜测目标；
- diagnostic 不含正文；
- reaction 和未知非消息事件不进入 entries；
- schemaVersion 或事件类型不支持时 fail closed，不生成部分请求。

### 7.4 确定性 hash

Canonical Context 先通过 Agent 包现有 RFC 8785 canonical JSON，再计算 SHA-256：

```text
canonicalContextHash = sha256CanonicalJson(canonicalContext)
```

同一输入的数组顺序固定为 `streamSeq ASC`，对象 key 顺序交给 canonical JSON。禁止使用普通 `JSON.stringify()` 作为身份 hash。

## 8. Canonical Memory Extractor 输入

Phase 3 新增纯函数：

```ts
interface CanonicalMemoryExtractionInputV1 {
  schemaVersion: 1;
  entries: Array<{
    eventId: string;
    role: "user" | "assistant";
    text: string;
  }>;
}
```

它从已经 reduce 完成的 Canonical Context 派生，不再次读取 Conversation Events。附件、metadata、runtime time、dispatch 和旧 prompt-shaped user text 都不进入 Phase 3 extraction input。

Phase 3 不把当前 Tape Extractor 切换到该输入，也不调用 extraction LLM。它只生成 hash 并参与 shadow boundary 测试。正式 Memory Event 写入留在 Phase 5。

## 9. Agent 模块边界

纯 Compiler 与 legacy shadow adapter 分开放置：

```text
packages/agent/src/context-compiler/       # L3
  types.ts
  conversation-reducer.ts
  attachment-resolver.ts
  compiler.ts
  memory-input.ts
  canonical-hash.ts
  diff-types.ts

packages/agent/src/engine/context-shadow/  # L5
  legacy-normalizer.ts
  diff.ts
  observer.ts
```

职责：

- `conversation-reducer.ts`：纯函数处理 cursor、boundary、edit/delete；
- `attachment-resolver.ts`：Port 类型与 unresolved 默认实现；
- `compiler.ts`：通过 ConversationEventStore 读取事实并组装 Canonical Context；
- `memory-input.ts`：从 canonical entries 构建 extraction input；
- `canonical-hash.ts`：唯一 hash 入口；
- `diff-types.ts`：不依赖 LLM 的 canonical summary/diff result 词汇；
- engine `legacy-normalizer.ts`：把旧 AgentMessage snapshot 变成可比较摘要；
- engine `diff.ts`：固定类别结构化 diff；
- engine `observer.ts`：异步执行 shadow，通过 Agent Port 写 metrics/result sink。

### 9.1 Shadow result Port 与 rollout composition

Agent 新增持久化 Port：

```ts
// packages/agent/src/ports/context-compiler-shadow-result-store.ts
export interface ContextCompilerShadowResultRecord {
  sourceEventId: string;
  accountId: string;
  compilerVersion: string;
  contextPolicyRevisionId: string;
  eventCursor: number;
  effectiveTime: string;
  timezone: string;
  canonicalContextHash?: string;
  canonicalMemoryInputHash?: string;
  legacySummaryHash?: string;
  canonicalEntryCount?: number;
  legacyEntryCount?: number;
  diffCounts: ContextCompilerShadowDiffCounts;
  status: "success" | "failed";
  errorCode?: string;
}

export interface ContextCompilerShadowResultStore {
  createOrVerifyEquivalent(result: ContextCompilerShadowResultRecord): Promise<void>;
}
```

Port 文件拥有 fixed diff category、持久化 DTO 和 equivalence error 契约，不导入 L3 类型，因此不需要新增 `ports -> context-compiler` upward exemption。L5 observer 只依赖该 Port；Server 的 Prisma implementation 实现它。Agent 不能导入 server store。

这里刻意不增加 Agent rollout store Port。Rollout 是 Server 账号 runtime 的部署配置，不是 Context Compiler 领域能力：

```text
server runtime
  -> PrismaContextCompilerShadowRolloutStore.isEnabled(accountId) once at startup
  -> enabled: construct/inject L5 shadow observer with result-store Port
  -> disabled: do not construct observer
```

因此 engine 不查询 rollout，也不依赖 Prisma rollout implementation。若未来需要运行中动态开关，再单独定义配置 resolver Port；Phase 3 不为未使用的依赖预留接口。

Layer check 新增 `context-compiler: 3`。该层只能导入同层、L1 ports 与 L0 shared，禁止导入 `engine`、`capabilities`、`memory`、`llm`、`prompts` 和 `commands`，也不增加 upward type exemption。`AgentMessage` 的 value/type import 只存在于 L5 engine legacy adapter；engine 可以向下导入 L3 canonical 类型。

Compiler 不依赖 server、Prisma、微信 SDK 或 provider codec。这样 legacy normalizer 不会污染纯 Compiler 的依赖边界。

## 10. Shadow 触发点

### 10.1 只在 ingress chat 触发

Phase 3 shadow 只覆盖拥有 `sourceConversationEventId` 的微信实时 chat：

```text
conversation lock acquired
  -> old history loaded
  -> old user AgentMessage assembled and appended
  -> clone legacy AgentMessage[] snapshot
  -> capture source event cursor + effectiveTime
  -> create pending shadow handle and start isolated compilation
  -> existing AgentRunner continues unchanged
  -> runner success: publish shadow result asynchronously
  -> runner failed/aborted/rolled back: discard pending result and count skipped
```

Command 不触发 model-context shadow；`/clear` 只追加 boundary。Scheduler、Heartbeat、Webhook 和主动消息没有对应 Phase 2 canonical ingress，留待 Run Ledger 阶段。

### 10.2 不阻塞现有业务

Shadow observer 必须：

- 接收 `structuredClone()` 后的 legacy snapshot，避免 runner 后续 mutation；
- 使用 source event 的 `streamSeq` 作为 cursor；
- 返回 pending handle，编译可在独立异步任务执行，但不能立即写 success result；
- 只有 runner 得到可提交的成功状态且 turn 未 rollback 时，调用 `handle.publish()` 写入 result；
- runner `error`、`aborted`、throw 或 rollback 时调用 `handle.discard("turn_failed")`，不写普通 diff result，只增加 skipped metric；
- publish/discard 必须幂等，晚到的 compile promise 不能越过 discarded terminal state；
- catch、记录分类并显式降级；
- 不改变 runner 参数；
- 不影响模型、发送、receipt settle 或 sync cursor；
- shutdown 时有独立 drain，超时只报警，不阻塞无限退出。

`max_rounds` 若现有业务把最后 assistant 内容作为有效回复，则视为成功；`complete` 视为成功；`error` 与 `aborted` 视为失败。模型配置缺失、engine 外层 fallback 和 user-message rollback 都必须 discard。事实读取失败、unsupported event、resolver 失败或 result sink 失败只标记 shadow error，不影响生产 chat。

## 11. Legacy diff 隔离

### 11.1 单向数据流

```text
Conversation Events -> Compiler -> Canonical
Legacy AgentMessage -> LegacyNormalizer -> LegacySummary
Canonical + LegacySummary -> Diff
```

禁止：

```text
LegacySummary -> Compiler
messages.payload -> canonical entry
projection link -> 补 canonical text/attachment
channelMetadata -> canonical entry
```

类型上通过不同模块和不可互换的 branded input 保证单向边界。

### 11.2 Diff 分类

固定类别：

- `match_user_text`；
- `legacy_user_has_runtime_time`；
- `legacy_user_has_tape_memory`；
- `legacy_user_has_visual_fallback`；
- `legacy_quoted_display_only`；
- `legacy_only_assistant_entry`；
- `legacy_only_tool_entry`；
- `canonical_unresolved_attachment`；
- `session_boundary_difference`；
- `entry_order_difference`；
- `unclassified_difference`；
- `shadow_compile_failed`。

Phase 3 不要求 hash 相等。预期目标是所有差异都进入已解释类别，`unclassified_difference` 收敛到零。

旧 Tape/time/Visual 的识别只发生在 legacy normalizer，用于分类旧请求，不进入 canonical 结果。分类器不得把匹配到的旧内容复制到日志或结果表。

## 12. Shadow rollout 与持久化

新增默认关闭表：

```text
context_compiler_shadow_rollouts
  account_id PK/FK accounts
  enabled boolean default false
  updated_at database time
```

账号 runtime 启动时通过 Server-owned `PrismaContextCompilerShadowRolloutStore` 读取一次，修改后通过现有 restart 生效。该 store 不注入 Agent；disabled 时 runtime 不构造 shadow observer。

新增 mutable 运维表：

```text
context_compiler_shadow_results
  source_event_id FK conversation_events RESTRICT
  account_id
  compiler_version
  context_policy_revision_id
  PK (source_event_id, compiler_version, context_policy_revision_id)
  event_cursor
  effective_time
  timezone
  canonical_context_hash
  canonical_memory_input_hash
  legacy_summary_hash
  canonical_entry_count
  legacy_entry_count
  diff_counts JSONB
  status success | failed
  error_code nullable
  created_at / updated_at database time
```

约束：

- `diff_counts` 只允许固定类别和非负整数；应用 parser 与数据库 CHECK 双重校验；
- 不保存 canonical body、legacy body、用户 text、metadata、Prompt、Tape 或本地路径；
- `(source_event_id, compiler_version, context_policy_revision_id)` 为主键，同一编译器与 policy 幂等，不同 revision 保留独立结果；
- result store 实现 Agent `ContextCompilerShadowResultStore` Port；
- `createOrVerifyEquivalent()` 先尝试 create；主键冲突后读取现有完整 identity/hash/counts/status 并做严格等价比较，等价则成功返回；任一字段不同则抛稳定 `ContextCompilerShadowResultEquivalenceError`；
- 禁止使用无条件 `ON CONFLICT DO UPDATE`；
- `effective_time` 与 `timezone` 必须持久化；同一主键但动态输入不同必须报 equivalence conflict，不能覆盖旧 hash；
- account 必须通过复合 FK 与 source event 一致；
- result 是运维 shadow projection，可更新，不是事实账本。

## 13. Observability

新增低基数指标：

```text
context_compiler_shadow_total{result=success|failed|disabled|skipped_turn_failed}
context_compiler_diff_total{category=<固定类别>}
context_compiler_entries{side=canonical|legacy}
context_compiler_unresolved_attachment_total
context_compiler_duration_ms
```

允许日志字段：

- accountId；
- sourceEventId；
- contextPolicyRevisionId；
- streamId；
- eventCursor；
- compilerVersion；
- canonical hash；
- status；
- errorCode；
- fixed diff counts。

禁止日志字段：text、canonical body、legacy body、metadata、Tape、Prompt、context token、media secret、本地路径。

## 14. 数据库变更

新增 migration：

```text
20260828200000_add_context_compiler_shadow_phase_3
```

内容：

1. 为 `weixin_ingress_dispatches` 增加 nullable `command_name` 与 `clear` 值 CHECK，不回填旧行；
2. 创建 `context_compiler_shadow_rollouts`，默认关闭；
3. 创建 `context_compiler_shadow_results`；
4. 为 result 建立 `(source_event_id, account_id)` 到 Conversation Event 的复合 FK；
5. 添加 status、hash、cursor、counts 和 JSON object CHECK；
6. 不修改、不回填、不删除旧业务行；
7. 不修改 Phase 1 append-only trigger；
8. 不给 `messages` 增加 compiler 字段。

`session_rotated` 使用现有 Conversation Event 表和 Store，不需要新事实表。

## 15. 错误处理

### 15.1 Boundary fail closed

Clear transaction 中任一步失败：

- legacy Message 删除、projection tombstone、route 删除、receipt command marker 和 boundary append 全部回滚；
- SDK 将本次业务 outcome 交给 settle 标记为 failed；
- 只有 terminal failed settlement 成功持久化后，cursor 才按现有 poison-message 规则推进；settle 自身失败时 cursor 不推进；
- canonical history 不会出现缺少 boundary 的已提交 clear；
- 日志不含 command 原文。

事务提交后、receipt terminal settle 前崩溃时，clear 与 boundary 已同时存在，receipt 可能保持 processing。管理员使用 Phase 2 abandon-only recovery；由于 side effect 已有事实，不自动重发确认或再次执行 clear。

Phase 4 生产读取切换设硬门禁：数据库不得存在 `command_name='clear'` 且 legacy projection 已清除但无 causation boundary 的异常状态。Phase 3 reconciliation 增加该不变量检查；一旦发现，禁止切换并提供仅管理员可用的 repair 命令。repair 只接受 source receipt ID，执行与正常 clear 相同的幂等事务，不接受自由文本 event 内容。正常 Phase 3 路径不应产生该状态，该工具用于历史数据或人工数据库操作后的恢复。

### 15.2 Compiler fail closed，shadow fail open

Compiler API 对以下情况抛稳定错误：

- cursor 非正整数或不存在；
- cursor event 不属于 account/stream；
- unsupported schema version；
- event sequence 不连续或重复；
- resolver 返回未知 source ref；
- resolved artifact 不存在；
- canonical JSON/hash 失败。

Shadow observer 捕获这些错误，记录 `shadow_compile_failed`，但现有业务继续执行。

### 15.3 Result sink 失败

result sink 失败不重跑模型、不修改 event、不阻塞 reply。保留 metrics 与结构化错误日志；Phase 3 不引入 shadow outbox。

## 16. 安全与隐私

- 纯 reducer、memory-input 和 hash 函数签名不接受 channel metadata；Store reader 返回完整 event 后，`compiler.ts` 必须通过逐类型显式 projector 立即收窄为内部 canonical fact，后续层不持有原 envelope；
- legacy adapter 与 compiler 目录互不导入；
- shadow 表不保存正文；
- hash 只用于变化检测，不作为用户文本匿名化替代物对外暴露；
- `/clear` 在 Phase 3 仍是上下文边界，不是隐私删除；旧 Message 的物理删除语义保持 Phase 2 行为；
- Conversation Events 按不可变审计保留。真正的隐私删除策略需要独立设计，不能借 `/clear` 偷渡。

## 17. 测试设计

### 17.1 Agent 纯单元测试

- 同一完整 CompileContextInput 产生稳定 Canonical Context/hash；
- 同一 facts/cursor 但不同 effectiveTime 产生不同 hash；
- 不同 metadata、sender snapshot、channel message ID 不影响 canonical hash；
- `channelMetadata` 中伪造同名 `effectiveTime`、`tapeMemory`、`visualContext` 不影响输出；只有显式 CompileContextInput.effectiveTime 生效；
- future event 不越过 cursor；
- latest boundary 之前的 entries 被排除；
- `/clear` inbound command event 不进入 boundary 后 session；
- edit 覆盖目标标准字段；
- delete 移除目标；
- dangling edit/delete 只产生固定 diagnostic；
- attachment refs 保持顺序，未映射时显式 unresolved；
- resolver 不得返回输入集合之外的 ref；
- Memory input 只含 event ID、role、原始 text；
- canonical request 和 Memory input 对 metadata 变化均完全相同；
- Compiler 模块静态检查禁止导入 MessageStore、Tape、微信 SDK 和 server。

### 17.2 Shadow diff 单元测试

- 健康原文匹配产生 `match_user_text`；
- old time/Tape/Vision/quoted display 被启发式分类但不复制到 canonical，且启发式结果不作为恢复证据；
- assistant/tool 缺失被标记为 expected legacy-only；
- unresolved attachment 分类稳定；
- 未知差异进入 `unclassified_difference`；
- diff result 不包含 text 或 payload。

### 17.3 SDK / lifecycle 测试

- ledger `/clear` 通过 `invokeClear(receiptId, conversationId)` 执行；
- `/echo` 和 `/toggle-debug` 不调用 `invokeClear`；
- clear transaction 失败时 legacy 删除和 boundary 同时回滚，settle outcome 为 failed；
- 用调用顺序 spy 锁定 slash handler 严格 `await invokeClear()` 成功后才调用 `sendReply()`，二者不得并行或交换；
- transaction/settle 的 cursor 行为符合现有 failed poison-message 规则；
- duplicate receipt 不重复 clear、不重复 boundary、不重复回复。

### 17.4 Server 单元测试

- deterministic boundary event ID 和 idempotency key；
- `invokeClear` 在同一 Prisma transaction 完成 legacy clear 与 boundary append；
- transaction 完成后 SDK 才发送确认并 settle receipt；
- runner failed/aborted/rollback 时 pending shadow 被 discard，result 表无普通 diff 行；
- runner complete/max_rounds 成功时才 publish；
- rollout disabled 不启动 shadow；
- observer clone legacy history，runner mutation 不污染 snapshot；
- shadow error 不影响 AgentRunner；
- failed/aborted/rolled-back turn 只产生 skipped metric，不写普通 shadow result；
- result parser 拒绝正文、未知 diff category 和额外字段；
- result Port 首次 create 成功、完全等价重放成功、任一 identity/hash/count/status 不同均抛 equivalence error；
- rollout disabled 时 runtime 不构造 observer，证明 engine 不查询 rollout store。

### 17.5 Disposable PostgreSQL 集成测试

- fresh deploy Phase 0–3 migrations；
- `/clear` 在同一事务把 receipt 标记为 `command_name=clear`；
- clear transaction 任意注入失败都不提交 Message 删除、route 删除或 boundary；
- `/clear` 产生一条 deterministic boundary，重投不重复；
- boundary 与 source inbound causation 正确；
- cursor 编译只读 throughSeq；
- shadow result account/source event 复合 FK 生效；
- 同一 result 主键但不同 effectiveTime 触发 equivalence conflict；
- shadow result 不含正文列；
- metadata-only event variation canonical hash 相同；
- result upsert 不修改 Conversation Event；
- Phase 1 append-only trigger继续拒绝 UPDATE/DELETE；
- rollout 缺失默认关闭。

### 17.6 回归测试

继续通过：

- Phase 0 微信业务基线；
- Phase 1 fact-ledger stores；
- Phase 2 ingress/receipt/projection tests；
- Agent、Server、SDK 全量测试和 typecheck；
- Agent layer check；
- Prisma validate、fresh migration deploy 和 status。

## 18. 文件级实施顺序

原子 clear 重构必须先独立完成并通过回归，不能与 Compiler 一次性混写：

1. 为现有 `MessageStore.clearMessages()` 与 `ConversationEventStore.append()` 补 characterization tests，固定 tombstone、counter、route、sequence、幂等和错误语义；
2. 抽取仅 Server 内部可见、接受 Prisma transaction client 的 message-clear 与 event-append helper；public Store 调用 helper 后行为必须与改前完全一致；
3. 实现 `clearIngressSession()` 单事务 service，增加每个事务步骤的 fault-injection integration test，证明任一步失败均无部分提交；
4. 接入 SDK `invokeClear()`，用调用顺序 spy 固定 transaction 成功后才发送确认；
5. 实现 L3 reducer、attachment resolver、Compiler、memory input 和 metadata-invariance 测试；
6. 实现 Agent result-store Port、Server Prisma result/rollout stores，以及 create-or-verify-equivalent 冲突测试；
7. 实现 L5 legacy adapter、diff 和 pending observer handle，再接入 `runChatTurn` success/discard lifecycle；
8. 最后接 runtime startup rollout、metrics、reconciliation 和 disposable PostgreSQL 全链路测试。

每一步单独保持 typecheck、layer check 和 Phase 0–2 回归通过。第 3 步未完成前不得接入 `/clear` 新 lifecycle；第 6 步未完成前 observer 不允许写数据库。

## 19. Rollout

上线顺序：

1. fresh disposable PostgreSQL 执行全部 migration 和集成测试；
2. 部署 expand-only Phase 3 migration；
3. 部署 boundary 支持，但 shadow rollout 默认关闭；
4. 验证 `/clear` boundary 与 Phase 2 receipt 链路；
5. 对内部账号启用 shadow；
6. 观察 compile failure、unclassified diff、unresolved attachment；
7. 扩展到更多账号；
8. Phase 3 保持 shadow，不执行读取切换。

停止条件：

- shadow 影响模型调用延迟、回复或 cursor；
- metadata 改变 canonical hash；
- Compiler 读取旧 Message、Tape 或微信 metadata；
- `/clear` 重投产生多个 boundary 或重复 side effect；
- unclassified diff 持续增长；
- shadow 表或日志出现正文、Prompt、secret、本地路径；
- source cursor 后的 future event 进入编译结果。

回滚：关闭 `context_compiler_shadow_rollouts` 并 restart 账号。已写 boundary 和 hash-only result 保留；旧聊天读取路径不变。

## 20. 验收标准

Phase 3 完成必须同时满足：

1. `/clear` 的 legacy clear、route 删除和显式 session boundary 在同一数据库事务提交，且 boundary 幂等、可因果追踪；
2. Compiler 只从 Conversation Events 标准字段构建 canonical entries；
3. metadata-only variation 不影响 canonical context、Memory input 或 hash；
4. cursor 和 boundary 语义由纯 reducer 与 PostgreSQL 集成测试覆盖；
5. attachment source ref 与 immutable Artifact 身份明确分离；
6. unresolved attachment 不通过旧路径猜测；
7. shadow diff 单向隔离，旧 payload 不补 canonical；
8. shadow 不调用模型、不改变生产请求、不阻塞业务，失败或 rollback turn 不写普通 diff result；
9. result 和日志不保存正文或 secret；
10. `unclassified_difference` 可观测；
11. 生产读取继续来自旧 Message/Tape；
12. Phase 0、1、2 全部回归继续通过。

## 21. 预计文件范围

### Agent

```text
A packages/agent/src/context-compiler/types.ts
A packages/agent/src/context-compiler/conversation-reducer.ts
A packages/agent/src/context-compiler/attachment-resolver.ts
A packages/agent/src/context-compiler/compiler.ts
A packages/agent/src/context-compiler/memory-input.ts
A packages/agent/src/context-compiler/canonical-hash.ts
A packages/agent/src/context-compiler/diff-types.ts
A packages/agent/src/context-compiler/index.ts
A packages/agent/src/ports/context-compiler-shadow-result-store.ts
A packages/agent/src/engine/context-shadow/legacy-normalizer.ts
A packages/agent/src/engine/context-shadow/diff.ts
A packages/agent/src/engine/context-shadow/observer.ts
M packages/agent/src/index.ts
M packages/agent/src/engine/chat-engine.ts
M packages/agent/src/engine/turn.ts
A packages/agent/test/context-compiler/*.test.ts
A packages/agent/test/context-shadow/*.test.ts
M packages/agent/scripts/check-layers.mjs
```

### Weixin SDK

```text
M packages/weixin-agent-sdk/src/agent/interface.ts
M packages/weixin-agent-sdk/src/messaging/slash-commands.ts
M packages/weixin-agent-sdk/src/messaging/process-message.ts
M packages/weixin-agent-sdk/src/monitor/monitor.ts
M packages/weixin-agent-sdk/test/monitor-ingress-lifecycle.test.ts
M packages/weixin-agent-sdk/test/process-message.business.test.ts
```

### Server

```text
A packages/server/src/weixin/session-boundary.ts
A packages/server/src/weixin/session-boundary.test.ts
A packages/server/src/db/clear-ingress-session.ts
A packages/server/src/db/clear-ingress-session.test.ts
M packages/server/src/db/conversation-event-store.impl.ts
M packages/server/src/db/message-store.impl.ts
M packages/server/src/weixin/ingress-controller.ts
M packages/server/src/weixin/ingress-controller.test.ts
A packages/server/src/db/context-compiler-shadow-rollout-store.ts
A packages/server/src/db/context-compiler-shadow-rollout-store.test.ts
A packages/server/src/db/context-compiler-shadow-result-store.ts
A packages/server/src/db/context-compiler-shadow-result-store.test.ts
A packages/server/src/context-shadow-observer.ts
A packages/server/src/context-shadow-observer.test.ts
M packages/server/src/runtime.ts
M packages/server/src/agent.ts
M packages/server/prisma/schema.prisma
A packages/server/prisma/migrations/20260828200000_add_context_compiler_shadow_phase_3/migration.sql
A packages/server/test-integration/context-compiler-shadow-phase-3.test.ts
```

### Observability

```text
M packages/observability/src/metrics/agent-metrics.ts
M packages/observability/src/metrics/index.ts
M packages/observability/src/index.ts
```

## 22. Phase 4 入口

Phase 4 在 Phase 3 的纯 reducer 和读取边界上增加 Run Ledger 与正式 Context Manifest：

- assistant/tool/skill/model 输出必须来自 Run Events，不从旧 Message 补；
- Prompt、Skill、Tool、Model revision 必须固定；
- Canonical Context V1 可以扩展 coverage，但不能改变旧编译结果的含义；
- 正式 manifest 持久化发生在模型调用前或同一可靠提交边界；
- Phase 3 shadow result 不是 manifest，也不能用于历史重放证明。

在 Run Ledger 和 outbound facts 完整前，不允许将 Phase 3 ingress-only canonical context 切换为生产模型读取源。
