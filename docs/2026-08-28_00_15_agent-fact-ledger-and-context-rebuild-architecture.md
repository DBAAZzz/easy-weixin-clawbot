# Agent 事实账本与确定性上下文重建架构

> 状态：Draft / 待审查
> 日期：2026-08-28
> 范围：`@clawbot/agent`、`@clawbot/server`、微信运行时、Tape、Vision、Skills、Tools、Observability
> 本文性质：目标架构与重构基线，不代表已经批准实施；本轮不修改业务代码和数据库 Schema。

## 1. 执行摘要

当前系统把以下内容组合成 `AgentMessage` 后，一起写入 `messages.payload`：

- 用户真实输入；
- 当前时间；
- Tape memory；
- Vision 识别结果或视觉 fallback 文本；
- 模型输出、reasoning、tool call 和 tool result。

这使 `messages` 同时承担“外部会话事实”“Agent 执行历史”“模型请求格式”和“Web 展示记录”四种职责。结果是：

1. 会话真实源被运行时派生内容污染；
2. Tape、时间或视觉策略变化后，无法判断历史消息正文中的内容来自用户还是当时的上下文组装；
3. 切换模型时只能复用旧模型形态的 transcript，无法从干净事实重新编译；
4. 现有 Trace 是采样和限期保留的可观测数据，不能承担永久行为审计；
5. 微信发送成功与“Assistant 已经写入历史”不是同一个原子事实，可能出现数据库认为说过、外部实际未送达的情况。

本文建议采用：

> **有边界的不可变事实流 + 不可变制品库 + 确定性上下文编译器 + 可随时重建的投影。**

这里的“唯一真实源”不解释为“整个系统只能有一张表”，而解释为：

> **同一种事实只有一个权威记录位置；其他状态都是可以删除后重建的投影。**

推荐保留三个逻辑上独立、因果上互相关联的事实流：

1. **Conversation Events**：用户、平台和已送达消息真实发生了什么；
2. **Agent Run Events**：Agent、模型、工具和投递流程做了什么；
3. **Memory Events**：Agent 对用户和会话形成了哪些可修正的记忆断言。

Prompt、Skill、Tool schema、模型配置、视觉观察、摘要、模型请求与响应等大内容使用不可变制品保存，通过内容 hash 和 revision ID 被事件引用。

`messages`、`conversations`、Tape 当前态、会话标题、消息数、搜索索引都降级为 Projection，不再是真实源。

## 2. 问题边界

### 2.1 本次要解决的问题

- 保证用户原文和平台事实保持干净，不包含系统注入内容；
- 能够从持久化事实重新构造任意模型所需的上下文；
- 切换模型、Prompt、Skill、Vision 或裁剪策略时不修改历史事实；
- 能够解释任意一次历史回答当时使用了哪些输入和版本；
- 区分“模型生成了内容”和“内容成功送达用户”；
- Tape memory 可追溯、可纠正、可重建；
- UI 历史和模型上下文可以使用同一批事实生成不同视图；
- 不破坏现有 Port/Adapter 分层，不让 `agent` 依赖 Prisma 或微信协议。

### 2.2 本次不追求的目标

- 不为了架构纯度立即引入 Kafka、Flink 或独立事件平台；
- 不要求通过重新调用 LLM 得到与历史完全相同的随机输出；
- 不把所有缓存、锁、队列、租约和运维状态都伪装成领域事件；
- 不在第一阶段重写 Web UI、Scheduler、Heartbeat 和全部工具；
- 不承诺把已经污染的旧 `messages.payload` 无损拆回原始事实。

## 3. 从 Cahciua 借鉴到的意义

参考项目：`/Users/mac/Documents/workspace/github/Cahciua`。

### 3.1 存储形态不应等于模型请求形态

LLM API 的 `messages[]` 是一次调用的请求参数，不是天然的数据库 Schema。

Cahciua 保存平台事件和 Driver turn responses，在调用模型前才执行：

```text
CanonicalIMEvent
  -> Projection
  -> IntermediateContext
  -> RenderedContext

RenderedContext + TurnResponses
  -> Context Composition
  -> Provider-independent entries
  -> Provider wire request
```

最重要的借鉴不是 XML，也不是某张 events 表，而是：

> **持久化事实与模型请求之间必须存在明确、可测试的编译边界。**

### 3.2 在线增量与冷启动重放必须使用同一个 reducer

如果线上更新状态和冷启动恢复状态使用两套逻辑，系统迟早出现“运行时看见的历史”和“重启后恢复的历史”不一致。

推荐约束：

```text
apply(currentProjection, newEvent)
  与
fold(emptyProjection, allEvents)

必须得到相同结果。
```

### 3.3 可重建事实与不可重现结果必须分开

平台消息、编辑、删除可以重放；LLM 输出、工具结果、网络响应和视觉识别结果不能靠重新执行保证一致。

Cahciua 明确采用 `events + turnResponses`，说明严格的一条纯事件流并不是必要条件。真正必要的是：

- 可重建部分保留原始事实；
- 不可重现结果原样落盘；
- 两者通过时间和因果关系参与后续上下文重建。

### 3.4 Late binding 是正确方向

当前时间、屏蔽策略、模型能力、上下文窗口和 provider 编码都应在请求时决定，不应回写到原始会话事实。

即使某个 provider 最终要求把这些内容编码成 `role=user`，项目内部也应保留它的真实来源，例如 `origin=runtime_context`，不能把它当成用户说过的话。

### 3.5 Provider-independent IR 是模型切换的基础

历史存储应保存规范化内容块和来源信息，而不是某个 provider 的 wire payload。切换模型时再处理：

- reasoning 兼容性；
- tool call/result 配对；
- tool ID 和 schema 编码；
- 图片直接输入或视觉文本替代；
- 当前模型的上下文预算和裁剪策略。

### 3.6 Cahciua 的不足也是本项目要补上的部分

Cahciua 并非完整的行为审计方案：

- 没有为每次调用固定完整 Prompt、Skill、Tool、配置 revision；
- 当前时间动态注入，但没有完整的历史请求 manifest；
- Visual alt text 使用独立缓存，历史调用没有强制固定 observation revision；
- 部分 event attachment 会被回填更新，不满足严格不可变；
- 多条持久化流之间的 causation/correlation 关系不够完整。

因此，本项目不应机械复制 Cahciua，而应保留它的“重建式上下文”核心，再补上不可变版本、因果链和请求清单。

## 4. 当前项目的事实源问题

### 4.1 Tape、当前时间和用户原文被拼成同一个持久化消息

`packages/agent/src/engine/turn.ts` 的 `buildUserMessage()` 调用 `assembleUserContext()`：

```ts
const assembledText = assembleUserContext(PROMPT_PROFILES.chat, {
  tapeMemory: memoryContext || undefined,
  time: new Date(),
  userText: text || "(no text)",
});
```

随后这个 `assembledText` 被放入 `AgentMessage`，并由 `appendMessage()` 进入内存历史和 `MessageStore`。

因此，数据库中的 user message 并不等于用户原文。

相关代码：

- [`packages/agent/src/engine/turn.ts`](../packages/agent/src/engine/turn.ts)
- [`packages/agent/src/prompts/assembler.ts`](../packages/agent/src/prompts/assembler.ts)
- [`packages/server/src/db/messages.ts`](../packages/server/src/db/messages.ts)

### 4.2 Visual Context 和 fallback 文本进入同一个消息对象

`prepareUserVisualContent()` 会将以下内容加入 user message：

- Vision 模型生成的 `<visual_context>` 文本；
- 没有 Vision 模型时的 placeholder；
- 图片识别失败时的 placeholder；
- image block 上的 `promptReplacementText`；
- `visualContext` sidecar。

整个消息对象随后进入 `messages.payload`。这使“用户上传了图片”与“某个模型对图片的观察”及“某次模型能力降级策略”混为一个永久记录。

相关代码：

- [`packages/agent/src/llm/vision.ts`](../packages/agent/src/llm/vision.ts)
- [`packages/agent/src/llm/types.ts`](../packages/agent/src/llm/types.ts)
- [`packages/agent/src/llm/messages.ts`](../packages/agent/src/llm/messages.ts)

### 4.3 `Message` 是模型形态的 transcript，而不是平台事实

当前 `Message` 表的核心字段为：

```text
accountId + conversationId + seq + role + contentText + payload
```

恢复历史时，系统直接读取 `payload` 并恢复成 `AgentMessage[]`，然后继续作为下一次模型上下文。

这意味着：

```text
DB storage shape == in-memory history shape ~= model request shape
```

系统缺少从原始事实到模型请求的正式编译层。

相关代码：

- [`packages/server/prisma/schema.prisma`](../packages/server/prisma/schema.prisma)
- [`packages/server/src/db/messages.ts`](../packages/server/src/db/messages.ts)
- [`packages/agent/src/engine/conversation/cache.ts`](../packages/agent/src/engine/conversation/cache.ts)

### 4.4 微信原始事件在 Agent 边界前被压平

微信 SDK 的 `ChatRequest` 只向 Agent 传递：

- `conversationId`；
- `text`；
- `media`；
- `contextToken`。

平台消息 ID、发送者快照、引用关系、编辑/删除语义、平台发生时间、本地接收时间和幂等键没有形成独立 Canonical Event。

这会限制后续的幂等、编辑/删除、确定性排序和审计能力。

相关代码：

- [`packages/weixin-agent-sdk/src/agent/interface.ts`](../packages/weixin-agent-sdk/src/agent/interface.ts)
- [`packages/weixin-agent-sdk/src/messaging/process-message.ts`](../packages/weixin-agent-sdk/src/messaging/process-message.ts)
- [`packages/server/src/agent.ts`](../packages/server/src/agent.ts)

### 4.5 “Assistant 已生成”与“Assistant 已送达”没有分开

Runner 产生 assistant message 后，会立即通过 callback 写入 `messages`。之后 `createAgent().chat()` 返回，微信 SDK 才执行真正的发送。

如果发送失败：

- Agent 历史可能已经包含该 Assistant；
- 用户实际上没有收到；
- 下一轮模型却可能认为自己已经说过。

必须区分：

```text
assistant_generated
delivery_requested
delivery_succeeded
delivery_failed
```

只有 `delivery_succeeded` 才能进入外部会话事实投影。

### 4.6 当前 seq 和异步写队列不是可靠的持久化顺序源

`ConversationCache` 在内存中维护 seq；`messages.ts` 异步排队写数据库。发生重启或缓存落后时，P2002 duplicate seq 目前会记录错误并放弃当前写入。

目标架构必须由数据库在 append 事务中分配或校验 stream sequence，不能让内存 seq 成为权威。

### 4.7 Tape 已有正确的 reducer 方向，但缺少完整 provenance

现有 Tape 的优点：

- Entry append；
- Anchor snapshot；
- `fold(anchor, incrementalEntries)`；
- global/session branch；
- handoff predecessors。

现有不足：

- chat 提取结果只记录笼统的 `source: "chat"`；
- 没有绑定 source message/event IDs；
- 没有固定 extraction model、Prompt 和 schema revision；
- compacted entry 会定期物理删除；
- 当前 memory state 可重建，但历史断言的完整证据链会丢失。

相关代码：

- [`packages/agent/src/memory/fold.ts`](../packages/agent/src/memory/fold.ts)
- [`packages/agent/src/memory/extractor.ts`](../packages/agent/src/memory/extractor.ts)
- [`packages/agent/src/memory/service.ts`](../packages/agent/src/memory/service.ts)
- [`packages/server/src/db/tape-store.impl.ts`](../packages/server/src/db/tape-store.impl.ts)

### 4.8 Trace 不能承担永久行为审计

当前正常 Trace 默认只保留 10% span 明细，且 normal/flagged 数据分别有 7/30 天清理周期。

另外，`llm.call` 的 `promptSnapshot` 当前主要记录裁剪后的 messages；system prompt、tool schema、skill revisions 和配置 revision 没有作为完整请求 manifest 固定。

Observability 应继续服务于排障、指标和采样分析，但不能作为系统事实源。

相关代码：

- [`packages/agent/src/engine/runner.ts`](../packages/agent/src/engine/runner.ts)
- [`packages/observability/src/sampling/types.ts`](../packages/observability/src/sampling/types.ts)
- [`packages/server/src/observability/service.ts`](../packages/server/src/observability/service.ts)

## 5. 目标架构原则

### 5.1 一个事实一个 owner，不追求一张万能表

“单一真实源”应该是语义约束，不是表数量约束。

| 事实 | 唯一权威 | 非权威派生物 |
| --- | --- | --- |
| 用户和平台发生了什么 | Conversation Events | UI messages、会话列表、搜索索引 |
| Agent、模型、工具做了什么 | Agent Run Events | Trace、运行详情页、成本报表 |
| Agent 当前相信什么 | Memory Events | TapeState、Memory graph、Prompt memory block |
| Prompt/Skill/Tool/视觉结果具体内容 | Immutable Artifacts/Revisions | 当前 registry、缓存、编译结果 |
| 最终模型请求 | Context Manifest + Request Artifact | 临时 `ModelMessage[]` |

### 5.2 原始事实、机器观察和策略产物必须分开

以图片为例：

- “用户上传了 asset A”是 Conversation Fact；
- “Vision 模型 V 对 A 输出描述 O”是 Machine Observation；
- “当前模型不支持图片，因此选择 O”是 Context Policy Decision；
- “最终 provider request 使用了 O”记录在 Context Manifest。

四者不能继续放进一个 user message body。

### 5.3 不可变不等于永不治理

事实流默认 append-only。需要更正、删除或隐私处理时使用：

- correction/supersede/tombstone event；
- 制品生命周期策略；
- 必要时使用加密和密钥销毁实现不可恢复删除；
- Projection 立即应用删除语义。

不应通过静默 UPDATE 历史事实获得“看起来正确”的当前状态。

### 5.4 每次模型调用都必须有可验证的输入清单

无需永久复制所有重复文本，但必须永久保存能够恢复当时输入的 manifest 和被引用的不可变 revision。

### 5.5 Projection 可以丢弃，事实不可依赖 Projection

必须可以执行：

```text
truncate conversation_messages;
truncate conversation_summaries;
truncate memory_state;

rebuild from facts;
```

并得到一致结果。

## 6. 总体结构

```text
Weixin / Webhook / Scheduler / Heartbeat
                  │
                  ▼
        Canonical Ingress Adapter
                  │
                  ▼
        Conversation Event Store ───────────────┐
                  │                             │
                  ├──> Conversation Projection │
                  ├──> Search Projection       │
                  └──> Memory Extraction       │
                                                │
Memory Event Store ───────> Memory Projection  │
Media Observations ─────────────────────────────┤
Prompt / Skill / Tool Revisions ────────────────┤
Model Config Revision ──────────────────────────┤
Clock / Runtime Context ─────────────────────────┤
                                                ▼
                                      Context Compiler
                                                │
                              Context Manifest + Request Artifact
                                                │
                                                ▼
                                           Model Call
                                                │
                                                ▼
                                        Agent Run Event Store
                                                │
                                                ▼
                                      Transactional Outbox
                                                │
                                  delivery_succeeded / failed
                                                │
                                                ▼
                                 Conversation Event Store
```

## 7. Conversation Event Store

### 7.1 职责

只记录外部会话世界的事实和明确的会话边界。

推荐事件类型：

```text
inbound_message_received
inbound_message_edited
inbound_message_deleted
session_started
session_rotated
outbound_message_delivered
outbound_message_delivery_failed
reaction_received
reaction_delivered
```

### 7.2 推荐事件 envelope

```ts
interface ConversationEventEnvelope {
  eventId: string;          // UUIDv7 / ULID
  accountId: string;
  streamId: string;         // effective conversation stream
  streamSeq: number;        // DB transactionally assigned
  eventType: string;
  schemaVersion: number;

  occurredAt: string;       // platform time
  receivedAt: string;       // local ingress time, ordering input
  recordedAt: string;       // committed time

  actor: { kind: "user" | "agent" | "system"; id?: string };
  causationId?: string;
  correlationId?: string;   // usually runId/traceId
  idempotencyKey?: string;

  payload: Record<string, unknown>;
}
```

必须建立：

- `UNIQUE(account_id, stream_id, stream_seq)`；
- 平台支持消息 ID 时的 source idempotency unique constraint；
- append-only DB 权限或触发器；
- event schema version 和 upcaster 策略。

### 7.3 用户消息 payload

推荐只保存：

```ts
{
  channel: "weixin",
  channelMessageId?: string,
  senderSnapshot?: { id: string; displayName?: string },
  text: string,
  attachmentRefs: string[],
  replyToEventId?: string,
  channelMetadata?: {
    schemaId: string,
    schemaVersion: number,
    data: Record<string, JsonValue>
  }
}
```

`channelMetadata` 是仅用于来源审计的版本化 opaque 信封：`schemaId` 和 `data` 的 schema 由渠道适配器拥有，核心只校验信封结构与 JSON 可序列化性，不硬编码微信或其他渠道字段。微信协议原始校验属于 `weixin-agent-sdk`，微信到 Conversation Event 的映射及 metadata 校验属于 server 微信 adapter。

禁止保存：

- Tape memory block；
- `[当前时间: ...]`；
- `<visual_context>`；
- 模型能力 fallback；
- Prompt/Skill 内容；
- provider-specific message。

这里的禁止约束针对标准 payload 字段；核心不通过 `channelMetadata.data` 的字段名黑名单猜测语义。防止派生上下文逃逸依赖两端不变量：只有可信 adapter 能构造并校验 metadata；任何上下文消费者都不得读取 metadata。若后续需要保留完整平台原始报文，应将其保存为 Artifact，并单独评审在 Conversation Event 标准 payload 中新增 `sourceArtifactId` 引用，而不是扩大 metadata 的职责；Phase 1 首版不纳入该扩展。

## 8. Agent Run Event Store

### 8.1 职责

记录一次 Agent run 的完整执行事实。它不是外部会话真相，但它是行为审计真相。

推荐事件类型：

```text
run_started
context_compiled
model_call_started
model_call_completed
model_call_failed
tool_call_requested
tool_call_completed
tool_call_failed
skill_loaded
run_interrupted
run_completed
delivery_requested
delivery_succeeded
delivery_failed
```

### 8.2 Run 因果关系

```text
inbound_message_received(eventId=E1)
  -> run_started(runId=R1, causationId=E1)
  -> context_compiled(manifestId=C1)
  -> model_call_completed(callId=M1)
  -> tool_call_completed(callId=T1)
  -> model_call_completed(callId=M2)
  -> delivery_requested(D1)
  -> delivery_succeeded(D1)
  -> outbound_message_delivered(causationId=D1)
```

这个因果图解决：

- 为什么 Agent 被唤醒；
- 当时看到了什么；
- 为什么调用某个工具；
- 工具返回什么；
- 最终生成了什么；
- 用户是否真的收到。

## 9. Immutable Artifact / Revision Store

### 9.1 需要保存的制品

- 原始媒体 asset；
- Visual Observation；
- Prompt revision；
- Skill revision；
- Tool definition/schema revision；
- Model configuration revision（不包含明文 secret）；
- Context Manifest；
- provider-independent request；
- 必要时保存 provider wire request；
- model response；
- compaction/summary artifact；
- 大型 tool result。

### 9.2 内容寻址

推荐使用：

```text
artifact_id
kind
sha256
schema_version
inline_json / storage_ref
created_at
encryption_metadata
```

相同 Prompt、Skill body 和 tool schema 只保存一次；历史调用通过 hash/revision ID 引用，减少重复存储。

### 9.3 Secret 不进入历史请求制品

模型 API Key、OAuth token、微信凭证不进入 artifact。Manifest 只记录 provider/template revision ID 和脱敏 endpoint identity。

## 10. Deterministic Context Compiler

### 10.1 职责

这是目标架构的核心。它是唯一允许把事实转换为模型请求的模块。

`channelMetadata` 不属于上下文输入。Compiler 必须按事件类型显式读取 `text`、`attachmentRefs`、`replyToEventId` 等标准字段，禁止展开整个 payload，也不得直接或间接读取 `channelMetadata`。两个仅在 `channelMetadata` 上不同的事件，必须编译出相同的 canonical request。

推荐接口：

```ts
interface CompileContextInput {
  accountId: string;
  conversationStreamId: string;
  eventCursor: number;
  runId: string;
  modelRevisionId: string;
  promptRevisionId: string;
  contextPolicyRevisionId: string;
  memoryWatermark: string;
  effectiveTime: string;
}

interface CompiledContext {
  entries: CanonicalConversationEntry[];
  system: CanonicalSystemContext;
  tools: CanonicalToolDefinition[];
  manifest: ContextManifest;
}
```

### 10.2 编译阶段

```text
1. Load canonical conversation facts at cursor
2. Apply edit/delete/session-boundary semantics
3. Load delivered agent messages and required run outputs
4. Load memory projection at explicit watermark
5. Resolve media policy and visual observation revisions
6. Resolve prompt/skill/tool/model revisions
7. Build provider-independent conversation IR
8. Apply model compatibility policy
9. Apply context window / summary policy
10. Encode provider request
11. Persist manifest before/with model call
```

### 10.3 Context Manifest

Manifest 至少记录：

```ts
interface ContextManifest {
  manifestId: string;
  compilerVersion: string;
  contextPolicyRevisionId: string;

  conversationEventIds: string[];
  runEventIds: string[];
  summaryArtifactIds: string[];
  memoryEventWatermark: string;
  memoryArtifactId?: string;
  visualObservationIds: string[];

  modelRevisionId: string;
  promptRevisionId: string;
  skillRevisionIds: string[];
  toolRevisionIds: string[];

  effectiveTime: string;
  timezone: string;
  trimDecision: Record<string, unknown>;

  canonicalRequestHash: string;
  providerRequestArtifactId?: string;
}
```

### 10.4 两种重放必须明确区分

**历史重放**：

- 使用原 manifest；
- 使用当时的 revision 和 dynamic values；
- 恢复当时真正发送给模型的请求；
- 不重新调用 LLM 来“猜”旧输出。

**反事实重编译**：

- 使用同一批 conversation facts；
- 选择新模型、新 Prompt、新 Skill 和新 policy；
- 生成一份新的 manifest；
- 用于模型迁移验证和策略 A/B 对比。

## 11. 当前时间的处理

当前时间不是会话事实，也不是用户内容。

目标行为：

1. `Clock` Port 在 run 开始时产生 `effectiveTime`；
2. Context Compiler 将其作为 `runtime_context` 注入 canonical IR；
3. provider codec 必要时将它编码成 system/developer/user wire role；
4. Manifest 记录准确的 `effectiveTime` 与 timezone；
5. 不写回 Conversation Event；
6. 不写进 UI 的用户消息正文。

这样既能让新调用看到当前时间，也能精确恢复历史调用当时看到的时间。

## 12. Vision 与媒体处理

### 12.1 原始事实

Conversation Event 只记录：

```text
用户消息引用了 asset A
```

Asset 使用已有 `@clawbot/asset` 能力保存，推荐继续采用内容 hash 和稳定 asset ID。

### 12.2 Visual Observation

Vision 输出保存为独立、不可变、带 provenance 的 observation：

```ts
interface VisualObservation {
  observationId: string;
  assetId: string;
  assetSha256: string;
  modelRevisionId: string;
  promptRevisionId: string;
  schemaVersion: number;
  generatedAt: string;
  output: {
    summary: string;
    ocrText: string[];
    objects: string[];
    confidence?: number;
    limitations?: string[];
  };
}
```

### 12.3 请求时选择

- 当前模型支持视觉：Context Compiler 引用原 asset；
- 当前模型不支持视觉：选择明确的 observation revision；
- observation 不存在：调用 Vision 并保存新 revision；
- Vision 失败或未配置：生成 request-local placeholder；
- placeholder 不进入 Conversation Event；
- Manifest 记录 fallback reason 和选择结果。

## 13. Tape / Memory 的目标模型

### 13.1 Memory 不是客观真相，而是带 provenance 的断言

推荐事件类型：

```text
memory_asserted
memory_superseded
memory_retracted
memory_corrected_by_user
memory_anchor_created
```

Memory Extractor 与 Context Compiler 遵循同一读取边界：只消费 Conversation Event 的标准上下文字段，不读取 `channelMetadata`。metadata 中即使出现 `effectiveTime`、`tapeMemory` 等名字，也不得影响抽取输入或结果。

每个 `memory_asserted` 至少关联：

- source conversation event IDs；
- source run ID；
- extraction model revision；
- extraction Prompt revision；
- category/scope/key/value/confidence；
- actor；
- assertedAt。

### 13.2 Current Memory State 是 Projection

可以继续使用现有 Tape reducer 思想：

```text
MemoryState = fold(lastAnchor.snapshot, newMemoryEvents)
```

但 Anchor 只是 checkpoint：

- 可删除后重建；
- manifest 只用于加速和校验；
- 不因 compact 而静默删除仍需审计的来源；
- retention 必须是明确产品政策，而不是 compact 的副作用。

### 13.3 用户纠正优先于模型抽取

“用户说我不喜欢咖啡”与“抽取模型判断用户喜欢咖啡”不能只是 last-write-wins。

Reducer 应至少考虑：

```text
user correction > explicit user assertion > trusted tool fact > model inference
```

## 14. Prompt、Skills 与 Tools 版本化

### 14.1 Prompt revision

启动时读取 Markdown 后计算 content hash，形成不可变 revision。每次 Context Manifest 引用 revision ID。

### 14.2 Progressive Disclosure Skills

渐进式披露本身可以保留，但状态来源需要调整：

当前实现通过扫描历史 tool result 里的 `<skill name="...">` 恢复已加载技能。目标实现应记录：

```text
skill_loaded {
  skillName,
  skillRevisionId,
  runId,
  round,
  causationToolCallId
}
```

历史重放固定旧 revision；新 run 是否继续沿用旧 skill，由 context policy 明确决定。

### 14.3 Tool revision

每次模型调用使用的 tool name、description、input schema 和执行 owner 都要有 revision hash。

工具执行结果记录实际 revision、参数 artifact、结果 artifact、超时和错误；不能只依赖未来可能已经变化的 registry。

## 15. 模型切换策略

### 15.1 永久保存 provider-independent 语义

Canonical IR 保存：

- user-visible text；
- assistant-visible text；
- tool call/result 结构；
- attachment refs；
- origin 和 provenance；
- model identity；
- delivery identity。

### 15.2 Reasoning 默认不跨模型携带

历史 reasoning、signature 和 provider 特有 metadata 不应被当作通用会话事实。

推荐规则：

- 同 provider、同模型兼容族且 compatibility key 匹配：可按策略保留；
- 其他情况：默认移除 reasoning；
- 可见 Assistant 文本保留；
- tool call/result 按 canonical structure 重新编码；
- 原始 provider response 留在 Run Artifact 中供审计，不进入当前模型上下文。

### 15.3 切换模型不修改历史

切换模型只会产生新的：

- model revision selection；
- context manifest；
- provider request；
- run events。

不会 UPDATE Conversation Events、Memory Events 或旧 Run Events。

## 16. Projection 与查询模型

建议保留或新增以下 Projection：

- `conversation_messages`：Web 对话时间线；
- `conversation_summaries`：标题、最后消息时间、计数；
- `conversation_routes`：微信会话到 active stream 的路由；
- `memory_state`：当前 facts/preferences/decisions；
- `memory_graph`：可视化关系；
- `run_details`：Agent 运行审计页面；
- `usage_daily`：计费和分析；
- `search_index`：全文检索；
- `context_cache`：可选的编译缓存。

现有 `messages` 与 `conversations` 可以在迁移期继续作为 Projection 表，以保持 Web API 兼容。

Projection 必须保存 offset/watermark，并支持：

- 从零 rebuild；
- 从 checkpoint 增量 rebuild；
- 幂等 apply；
- schema version 升级；
- 与源事件 checksum/数量对账。

## 17. 一致性、幂等与投递

### 17.1 Persist before process

新入站流程：

```text
receive platform update
  -> canonicalize
  -> append inbound event transactionally
  -> commit/ack
  -> async or synchronous processing
```

Vision、Tape、LLM 和工具调用都发生在入站事实持久化之后。

### 17.2 数据库分配 stream sequence

使用数据库事务维护 stream head，或通过可靠的序列分配方式写入。禁止依赖进程内 `nextSeq()` 作为持久化真相。

### 17.3 Transactional Outbox

外部发送采用：

```text
append delivery_requested + outbox row in one transaction
worker sends to Weixin
append delivery_succeeded / delivery_failed
on success append outbound_message_delivered
```

Outbox row可以有 mutable 状态和 retry lease，因为它是运维协调状态，不是会话真相。

### 17.4 Inbox / deduplication

平台提供消息 ID 时使用唯一约束；没有稳定 ID 时建立明确的 deduplication fingerprint 和时间窗口。

重复 ingress 不得产生重复 Conversation Event 和重复 run。

## 18. Port/Adapter 影响

保持 `agent -> ports <- server adapters` 方向不变。渠道 metadata 的写入权属于 server 的可信渠道 adapter：SDK 负责协议原始对象校验，adapter 负责映射标准字段并按渠道 schema 校验、构造版本化 opaque 信封；`agent` 不拥有任何渠道字段白名单。

推荐逐步引入：

```text
ConversationEventStore
AgentRunStore
MemoryEventStore
ArtifactRevisionStore
ProjectionStore
OutboxPort
Clock
```

原 `MessageStore` 在迁移期承担 Projection 兼容层，最终不再被 AgentRunner 用作真实历史来源。

`ContextCompiler` 属于 `packages/agent` 的纯领域/编排能力；具体事件、制品和 projection 读取通过 Ports 注入。

## 19. 高层迁移方案

本文只确定阶段和边界。每一阶段的具体 migration、兼容 adapter、测试和回滚策略需要在本文通过审查后单独拆成执行计划。

### Phase 0：冻结语义与建立验收基线

- 为当前入站、普通聊天、工具循环、Vision fallback、模型切换、`/reset`、Scheduler 和 Heartbeat 建 characterization tests；
- 定义 canonical event、run event、memory event 和 context manifest schema；
- 定义历史重放与反事实重编译的验收样例；
- 不改变生产行为。

### Phase 1：事实账本基础设施

- 新增 append-only stores 和 migrations；
- 建立 event envelope、stream seq、idempotency、causation/correlation；
- 新增 Artifact Revision Store；
- 暂不切换读取路径。

### Phase 2：Ingress 先落事实，现有链路双写

- 扩展微信 SDK 到 server 的 canonical ingress 数据；
- 在 server 微信 adapter 中映射标准字段，并校验 `seq`、`client_id` 等微信 metadata；adapter 必须拒绝不属于渠道 schema 的派生上下文字段；
- 平台消息先写 Conversation Event；
- 继续调用现有 `chat()`，保证用户行为不变；
- 对账 events 与旧 messages。

### Phase 3：Context Compiler shadow mode

- 从 Conversation Events 编译 canonical context；
- 用业务测试固定读取边界：仅 metadata 不同的事件必须生成相同 canonical request，Memory Extractor 输入也必须相同；
- 与当前 `AgentMessage[]` 请求做结构化 diff；
- 不将 shadow 请求发送给模型；
- 收敛差异后，按会话或账号灰度切换。

### Phase 4：Run Ledger 与 Context Manifest

- 每次模型、工具和 skill 调用写 Run Events；
- 固定 Prompt/Skill/Tool/Model revisions；
- 保存 Context Manifest 和 request hash；
- Trace 改为 Run Ledger 的可观测投影，而不是唯一证据。

### Phase 5：Vision 与 Tape 解耦

- Visual Observation 从 Message payload 拆到不可变 artifact；
- placeholder 改为 request-local 编译结果；
- Tape entry 增加 source event IDs 和 extraction revisions；
- Anchor 明确降级为 Projection checkpoint。

### Phase 6：Outbound delivery 与 Projection 切换

- 引入 Transactional Outbox；
- 只有 delivery success 生成外部会话消息；
- Web messages/conversations 改从 Projection 查询；
- 验证 Projection 全量重建。

### Phase 7：旧路径退出与历史边界

- 停止写入 prompt-shaped `messages.payload`；
- 旧记录导入为 `legacy_transcript_imported` 或独立 legacy projection；
- 对旧历史标注 `reconstructability=partial`；
- 不通过脆弱正则假装能恢复已经混合的用户原文、Tape 和时间；
- 经过保留期和回滚窗口后移除旧真实源读取路径。

## 20. 验收标准

### 20.1 事实纯净

- Conversation Event 中的用户 text 与平台输入一致；
- 核心契约接受不同渠道的版本化 JSON metadata，不维护平台字段白名单；
- 渠道 metadata 只用于来源审计，不影响 Context Compiler、Memory Extractor 或模型请求；
- 不出现 `<memory>`、当前时间、Visual Context 或 fallback placeholder；
- UI 用户消息只显示用户原文。

### 20.2 可重建

- 清空 `messages`、`conversations`、memory state、搜索索引后，可从事实流重建；
- online apply 与 cold replay 结果一致；
- Projection rebuild 有 checksum/数量对账。

### 20.3 可审计

任意一次模型回答可以定位：

- trigger/source event；
- Context Manifest；
- memory watermark；
- Visual Observation revision；
- Prompt/Skill/Tool/Model revisions；
- 每一轮模型 request/response；
- tool call/result；
- 最终 delivery 结果。

### 20.4 模型可迁移

- 切换模型不修改历史事实；
- 同一事实集可以生成新模型的上下文；
- reasoning 和 provider metadata 按兼容规则处理；
- 图片可根据当前模型能力重新选择直接视觉或 observation。

### 20.5 一致性

- 重复 ingress 不产生重复 run；
- 进程重启不会因内存 seq 落后而丢消息；
- delivery failed 不显示为已送达；
- Tape memory 可追溯到来源事件。

## 21. 审查时需要确认的决策

以下内容需要在进入详细实施计划前由项目负责人确认：

1. 是否接受“每类事实一个权威流”，而不是“一张万能 events 表”；
2. 完整 Context Manifest 和模型 request artifact 的保留周期；
3. 是否要求永久恢复 provider wire request，还是恢复 canonical request 即可；
4. 原始图片和其他资产的保留、隐私删除与加密策略；
5. Normal run 是否全量保存 response/request，还是对超大工具结果采用分层存储；
6. Tape compacted entries 是否停止自动删除，或改用明确的合规 retention；
7. 旧 `messages` 的处理：只读归档、legacy projection，还是在一定期限后清理；
8. `/reset` 的准确语义：追加 session boundary，还是同时触发隐私删除；
9. delivery success 的平台确认能力，以及微信接口缺少稳定 message ID 时的降级方案；
10. 是否需要在第一版支持编辑/删除事件，还是先保留 schema 能力后续接入。

## 22. 最终判断

本项目真正需要的不是“把 `Message` 改名为 Event”，也不是给 session 增加一个 context 字段。

需要改变的是数据所有权：

```text
当前：
模型 transcript 是源，用户事实、Memory、时间和 Vision 混在其中。

目标：
事实流和不可变制品是源，模型 transcript 是一次可证明、可重建的编译结果。
```

该架构保留现有项目已经做对的部分：

- Port/Adapter；
- agent/server 单向依赖；
- Tape reducer 和 Anchor；
- provider-independent AgentMessage 思路；
- Skill Registry 与渐进式披露；
- Asset 抽象；
- Trace 与 Metrics。

同时修复真实源污染、历史不可审计、模型切换脆弱、视觉派生固化和投递状态不一致等根问题。

在本文通过审查前，不应直接进入 Schema 和代码重构。审查通过后，应先单独输出 Phase 0/Phase 1 的文件级实施计划、迁移策略、兼容策略、测试矩阵和回滚条件，再开始第一步代码修改。
