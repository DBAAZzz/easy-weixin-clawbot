# Fact Ledger Phase 2：微信 Ingress 先落事实与旧链路双写

> 状态：Draft / 待 CR  
> 日期：2026-08-28  
> 前置：Phase 1 Store、migration 与 disposable PostgreSQL 集成测试已通过  
> 范围：只接入微信入站事实、可靠去重分发和旧 `messages` 对账；不切换读取路径，不写完整 Run Ledger

## 1. 目标

Phase 2 将微信入站边界改为：

```text
Weixin getUpdates
  -> SDK 校验协议身份与时间字段
  -> server 微信 adapter 映射 canonical Conversation Event
  -> ConversationEventStore.append()
  -> 建立可去重的 ingress dispatch receipt
  -> 继续执行现有 slash command / agent.chat() / 微信发送
  -> 旧 MessageStore 继续写 messages，并建立持久化 projection link
  -> 持久化 get_updates_buf
```

完成后必须满足：

1. 所有微信入站消息，包括 `/clear`、`/echo`、`/toggle-debug`，均先成为不可变 Conversation Event；
2. 重复平台消息不重复调用命令或 `agent.chat()`；
3. 事实写入失败时，不执行命令、不调用模型、不发送回复，也不推进持久化 sync cursor；
4. 用户原文与微信来源 metadata 分离，Tape、当前时间、Vision fallback 和本地媒体路径不得进入入站事实；
5. 现有聊天、命令、媒体下载、消息持久化和回复行为保持不变；
6. 新事实与旧 user message 可通过独立 projection link 精确对账；`/clear` 后保留 cleared tombstone，不按时间或文本猜测。

## 2. 非目标

Phase 2 不做：

- 从 Conversation Events 读取聊天历史；
- Context Compiler 或 shadow request；
- 完整 Agent Run Event 双写；
- Memory Event、Context Manifest 或模型 request/response artifact；
- Transactional Outbox 和 outbound delivery fact；
- 将微信原始报文、CDN URL、AES key 或 context token 保存为 Artifact；
- 自动重放已经进入 `processing` 但进程崩溃的任务；
- 清洗、回填或改写旧 `messages.payload`；
- 改变 `/clear` 当前会话清理语义。

Outbound、Run Ledger、Context Compiler 和可重放媒体分别留在后续阶段。Phase 2 只确保入站事实先落库、实时处理不重复，并把无法自动恢复的中断显式暴露出来。

## 3. 方案比较

### 方案 A：只扩展 `ChatRequest`，在 `createAgent().chat()` 内 append

优点是改动最小。缺点是 SDK 直接处理的 slash command 不会进入账本，媒体下载已经发生在事实写入之前，而且重复命令无法去重。该方案不满足“所有 ingress 先落事实”。

### 方案 B：SDK 增加 pre-process hook，`appended: false` 直接跳过

可以覆盖 slash command，并保持事实先落库。但“event 已提交、进程在调用 chat 前崩溃”后，重投只会得到 `appended: false`，系统无法区分“已处理”与“尚未处理”。该方案隐藏了 crash gap。

### 方案 C：pre-process hook + mutable ingress dispatch receipt（采用）

Conversation Event 仍是唯一入站事实；独立 receipt 只记录运维分发状态。平台重投时先按事实幂等，再按 receipt 决定处理或跳过。这样不会把 mutable 状态写进事件表，也不会用 `messages` 反推是否处理过。

Phase 2 采用方案 C。receipt 不是新的业务真相，不参与上下文编译，可在未来被正式 inbox/worker 替换。

## 4. 边界与依赖方向

### 4.1 SDK 的职责

`weixin-agent-sdk`：

- 校验微信协议字段；
- 在媒体下载、命令处理和 Agent 调用之前调用 ingress lifecycle hook；
- 将 hook 返回的 `receiptId` 作为不透明值传给 lifecycle 的 `invokeAgent()` 和 `settle()`；
- 只有获得 `process` disposition 才执行现有业务链路；
- 返回本次处理属于 `chat`、`command` 或 `failed`，不理解 Fact Ledger 契约。

SDK 不导入 `@clawbot/agent`，不构造 Conversation Event，也不在通用 `ChatRequest` 中携带 event ID。

### 4.2 Server 微信 adapter 的职责

server 新增可信微信 ingress adapter：

- 拥有微信 metadata v1 schema；
- 将 SDK 已校验的 ingress DTO 映射为 `AppendConversationEventInput`；
- 调用 `ConversationEventStore.append()`；
- 创建或读取 dispatch receipt；
- 返回 `process` 或 `skip`；
- 通过 receipt 在 server 内部解析 source event，再调用 ingress 专用 chat 入口；
- 记录处理完成、失败和对账状态。

adapter 依赖 Agent Port，不直接写 Prisma `conversation_events`。

### 4.3 Agent 的职责

Agent 继续使用旧 `ChatEngine` 和 `MessageStore`。server 的 ingress 专用 chat 入口把 `sourceConversationEventId` 直接传给 `ChatTurnInput`，不经过 SDK `ChatRequest`；Agent 再将其作为 MessageStore 持久化元数据。该字段不得进入 `AgentMessage`、Prompt、模型请求、Tape 或 Memory Extractor 输入。

依赖方向保持：

```text
weixin-agent-sdk <- server adapter -> agent ports
server -> agent
agent 不依赖 server 或 weixin-agent-sdk
```

## 5. SDK 协议校验契约

新增 SDK 内部的 `ValidatedWeixinInbound`，只包含后续映射需要的已校验字段。它不是 Conversation Event：

```ts
interface ValidatedWeixinInbound {
  conversationId: string;
  senderId: string;
  recipientId?: string;
  groupId?: string;
  seq: number;
  clientId?: string;
  messageId?: number;
  occurredAtMs: number;
  receivedAtMs: number;
  sessionId?: string;
  messageType?: number;
  messageState?: number;
  items: ValidatedWeixinItem[];
}
```

校验规则：

- `from_user_id` 必须是非空字符串；
- `seq`、`create_time_ms` 必须是非负 safe integer；
- `message_id` 和 item time 若存在，也必须是非负 safe integer；
- `client_id`、`session_id`、`group_id` 和 item `msg_id` 若存在必须是非空字符串；
- item `type` 若存在必须是非负 safe integer；
- 身份优先使用 safe `message_id`；缺少 `message_id` 时必须同时具有非空 `client_id` 和 safe `seq`；
- 不允许用正文 hash、接收时间或随机数补造平台身份；
- 当前 SDK 业务链路只支持 direct chat。`group_id` 非空时返回稳定的 `unsupported_group_chat` 错误，既不 append，也不按 sender 错误拆流；
- Monitor 收到 getUpdates 响应后，必须先为 batch 内所有消息一次性采集各自的 `receivedAtMs`，再开始任何 append、下载、命令或 chat；同一内存 batch 重试时不得重新生成；
- 协议身份无效时 fail closed，不调用 ingress adapter，不处理消息，不推进 sync cursor。

微信消息不支持编辑或删除。Phase 2 只产生 `inbound_message_received`，不映射通用契约中的 `inbound_message_edited` 或 `inbound_message_deleted`，也不把 `update_time_ms`、`delete_time_ms` 写入微信 metadata v1。

`message_id` 是首选平台身份；`client_id + seq` 是缺少 message ID 时的明确 fallback。正式启用账号灰度前，必须在不记录正文和 secret 的前提下统计 identity source、缺失率与冲突率；任一身份来源出现非零冲突时停止扩量。

## 6. Canonical 微信映射

### 6.1 固定字段

Mapper 先生成唯一的 `sourceIdentity`：

```text
message_id 存在：message:<messageId>
否则：          client-seq:<clientId>:<seq>
```

每条有效 direct-chat 微信消息映射为：

```ts
{
  eventType: "inbound_message_received",
  schemaVersion: 1,
  accountId,
  streamId: senderId,
  occurredAt: new Date(occurredAtMs).toISOString(),
  receivedAt: new Date(receivedAtMs).toISOString(),
  actor: { kind: "user", id: senderId },
  idempotencyKey: `weixin:v1:${sourceIdentity}`,
  payload: {
    channel: "weixin",
    channelMessageId: sourceIdentity,
    senderSnapshot: { id: senderId },
    text: canonicalText,
    attachmentRefs,
    channelMetadata: {
      schemaId: "weixin/inbound-message",
      schemaVersion: 1,
      data: metadata
    }
  }
}
```

Phase 2 明确只支持 direct chat，因此 `streamId = senderId`。带 `group_id` 的消息在映射前 fail closed，不能按 sender 拆成多个错误的群聊事实流。未来支持群聊时必须发布新的微信 metadata schema version，并以 `group_id` 作为渠道会话身份；不能改变已写 direct stream 的含义。现有 effective conversation/session route 仍只是旧投影的会话划分，不改写外部事实流身份。

### 6.2 Event ID

Event ID 必须跨进程确定性稳定：

```text
weixin-inbound-v1:<sha256(accountId + NUL + sourceIdentity)>
```

- 使用小写十六进制 SHA-256；
- 不包含用户正文；
- 同一平台身份在不同账号下不会冲突；
- `message_id` 存在时，client ID 的变化不会制造第二条事实，但 metadata 变化仍会触发等价性冲突并报警；
- Event ID 与 idempotency key 同时保留：前者提供全局事实身份，后者提供 account-scoped 平台重试语义。

### 6.3 Canonical text

Ledger text 与旧 `ChatRequest.text` 分开生成：

- 文本消息只保存当前 text item 的原始 `text`；
- 语音仅在平台 item 已提供转写 `voice_item.text` 时保存该平台转写；
- quoted message 不再拼接 `[引用: ...]` 到 ledger text；
- 无文本的纯媒体消息保存空字符串；
- `bodyFromItemList()` 保持不变，旧聊天链路继续看到当前行为。

这保证 ledger 不把 SDK 派生展示文本伪装成用户原文。

### 6.4 Attachment refs

媒体下载必须发生在 append 之后，因此 Phase 2 不依赖本地 asset ID。`attachmentRefs` 使用确定性的渠道来源引用：

```text
weixin-attachment-v1:<sha256(accountId + NUL + sourceIdentity + NUL + itemIndex)>
```

仅媒体 item 生成引用，数组顺序与平台 item 顺序一致。它们在 Phase 2 表示 source attachment identity，不声称 Artifact Revision 已存在。Phase 5 创建不可变媒体 Artifact 时复用该来源身份建立映射。

### 6.5 Reply relation

微信 `ref_msg` 当前不稳定提供目标顶层 `client_id`，因此 Phase 2 不猜测 `replyToEventId`。引用 item 的 `msg_id` 和类型只进入微信 metadata。不得根据引用标题或引用正文反查事件。

## 7. 微信 metadata v1

server adapter 维护严格的 metadata schema，只接受以下来源字段：

```ts
interface WeixinInboundMetadataV1 {
  identitySource: "message_id" | "client_id_seq";
  seq: number;
  clientId?: string;
  messageId?: number;
  recipientId?: string;
  sessionId?: string;
  messageType?: number;
  messageState?: number;
  items: Array<{
    index: number;
    type?: number;
    msgId?: string;
    createTimeMs?: number;
    isCompleted?: boolean;
    refMsgId?: string;
    refType?: number;
  }>;
}
```

明确禁止：

- `context_token`；
- CDN URL、encrypt query、AES key；
- 下载后的本地路径；
- MIME 推断结果和 Vision observation；
- Tape、effective time、Prompt、模型能力或 fallback；
- `bodyFromItemList()` 生成的 quoted 展示文本；
- 未在 v1 schema 中声明的任意字段。

server mapper 必须先通过微信 metadata v1 parser，再调用核心 Append Input parser。测试应主动注入 `effectiveTime`、`tapeMemory`、`visualContext` 和额外 symbol/hidden 字段，证明 adapter 拒绝它们。

## 8. Ingress lifecycle 与 dispatch receipt

### 8.1 SDK hook

Monitor options 增加必需的 lifecycle：

```ts
interface WeixinIngressLifecycle {
  accept(input: ValidatedWeixinInbound): Promise<{
    receiptId: string;
    disposition: "process" | "skip";
  }>;
  invokeAgent(input: {
    receiptId: string;
    request: ChatRequest;
  }): Promise<ChatResponse>;
  settle(input: {
    receiptId: string;
    outcome: "chat" | "command" | "failed";
    errorCode?: string;
  }): Promise<void>;
}
```

`receiptId` 对 SDK 是 opaque token。启用 ledger 的路径必须通过 server lifecycle 的 `invokeAgent()`，controller 在 server 内部由 receipt 解析 event ID，再调用 ingress 专用 chat 入口。SDK 的通用 `ChatRequest` 不增加 Fact Ledger 字段；未启用账号继续直接调用现有 `Agent.chat()`。

### 8.2 Receipt 表

新增 mutable 运维表 `weixin_ingress_dispatches`：

| 字段 | 约束/含义 |
| --- | --- |
| `event_id` | PK，FK `conversation_events.event_id`，RESTRICT |
| `account_id` | 非空，便于运维查询 |
| `status` | 枚举字符串：pending、processing、completed、failed；CHECK |
| `outcome` | 枚举字符串：chat、command、failed；完成后填写 |
| `attempt_count` | 首次 claim 加一；Phase 2 最大为 1 |
| `claimed_at` | 首次进入 processing 的数据库时间 |
| `completed_at` | terminal 时间 |
| `error_code` | 脱敏低基数字符串，不保存错误正文 |
| `recovery_operator` | 人工终止 stuck receipt 时必填 |
| `recovery_reason` | 人工终止原因；限制长度，不含正文 |
| `recovered_at` | 人工终止的数据库时间 |
| `created_at/updated_at` | 数据库时间 |

receipt 可以 UPDATE，因为它是 inbox 协调状态，不是事实。不得在其中保存 text、metadata、context token 或媒体地址。

账号灰度使用独立 `weixin_ingress_rollouts` 表：`account_id` 为主键和 Account 外键，`enabled` 默认为 false，`updated_at` 使用数据库时间。Runtime 启动账号前读取一次；修改后通过现有账号 restart 生效。Phase 2 不新增 Web UI 或 HTTP API，部署操作者通过审查过的 SQL 显式增删/启用账号行。未出现在表中的账号继续旧路径。

### 8.3 accept 状态机

1. 调用 `ConversationEventStore.append()`；
2. 按 `event_id` upsert receipt；
3. `pending -> processing` 使用条件 UPDATE 原子 claim；
4. claim 成功返回 `process`；
5. receipt 已是 `processing/completed/failed` 返回 `skip`；
6. append 语义冲突直接失败，不创建/更新 receipt。

`appended: false` 不等于盲目丢弃：它先查 receipt。这样 event 已写但 receipt 尚未创建的重投可以补建 pending receipt；已处理或正在处理的重复消息不会再次启动业务链路。

Phase 2 不自动回收 `processing` lease。进程在 claim 后崩溃时，该行保持 processing，避免静默重复模型调用或命令副作用；超过五分钟即进入 stuck 告警。Phase 2 只允许管理员把 stuck receipt 条件更新为 `failed/operator_abandoned`，不允许重置为 pending 或自动重放；具体恢复协议见 12.4。

## 9. Batch、sync cursor 与处理顺序

Monitor 收到一次 getUpdates 响应后，先同步快照整个 batch 的 `receivedAtMs`，避免后部消息的接收时间被前部 LLM 延迟污染；随后按平台原顺序处理：

```text
capture receivedAtMs for every message
for each message:
  validate ingress
  accept -> fact + receipt + claim
  if process:
    processOneMessage using lifecycle.invokeAgent(receiptId, request)
    settle completed/failed
  if skip:
    do not call command/chat/send

when every message reached processing/completed/failed:
  await onSyncBufUpdate(newBuf)
  update in-memory getUpdatesBuf
```

关键变化：

- `onSyncBufUpdate` 改为返回 `Promise<void>` 并被 await；
- 不能在消息 append 前持久化或切换内存 cursor；
- 任一协议校验、append、receipt upsert 或 claim 操作失败时，整个 batch 不推进 cursor；
- batch 前部已完成、后部失败时，平台重投前部会命中 completed receipt 并跳过，后部继续尝试；
- `processOneMessage` 的业务错误按现有策略发送错误提示，settle 为 `failed` 后允许 cursor 前进，避免 poison message 永久阻塞账号；
- sync cursor 保存失败时内存 cursor 也不前进，下一次重投依靠 receipt 去重。

## 10. Slash command 与媒体顺序

### 10.1 Slash command

Ingress accept 必须发生在 slash command 检测之前。`/clear` 等命令：

- 先写 `inbound_message_received`；
- claim 成功后执行现有命令；
- settle outcome=`command`；
- 不调用 `agent.chat()`，也不创建旧 user message；
- duplicate receipt 不重复清理会话、不重复切换 debug、不重复回复。

Phase 2 只记录 `/clear` 的入站事实，不新增 `session_rotated`。这是明确的阶段边界：外部微信流保持稳定，旧会话清理行为保持不变；Context Compiler 接入前必须单独确定 session boundary 事实语义。

### 10.2 媒体

顺序必须是：

```text
validate identity -> append fact -> claim -> download/decrypt -> old asset ingest -> chat
```

媒体下载失败保持当前降级行为，但事实中的 attachment ref 仍存在。不得把下载失败、local path 或 MIME 推断回写到 Conversation Event。

## 11. 旧 messages 双写与精确对账

### 11.1 Source event 只在 server/agent 内部传递

SDK `ChatRequest` 保持不变。`WeixinIngressLifecycle.invokeAgent(receiptId, request)` 在 server controller 内查询 receipt 对应的 event ID，并调用 server 内部 `chatFromIngress(request, sourceConversationEventId)`。该内部入口把 ID 传给 `ChatTurnInput`，只在追加本轮 user message 时传给 MessageStore：

```ts
interface PersistMessageParams {
  // existing fields
  sourceConversationEventId?: string;
}
```

Assistant、tool result、trigger、命令和主动消息不设置该字段。ID 不得进入 `AgentMessage` 或任何模型可见结构。

### 11.2 Durable projection link

不在 `messages` 上增加 source event 列；新增 `legacy_message_projection_links`，让 `/clear` 删除 Message 后仍保留对账证据：

| 字段 | 约束/含义 |
| --- | --- |
| `event_id` | PK，FK Conversation Event，RESTRICT |
| `account_id` | 非空，必须与 source event 一致 |
| `conversation_id` | 旧 effective conversation ID |
| `message_seq` | 旧 Message seq |
| `message_id` | nullable UNIQUE，FK Message，ON DELETE SET NULL |
| `state` | persisted 或 cleared；CHECK |
| `linked_at` | Message 与 link 事务提交时间 |
| `cleared_at` | `/clear` 后的数据库时间 |

持久化 source-linked user Message 时，Message insert 与 projection link insert 必须处于同一个 Prisma transaction。数据库 Trigger 在 link INSERT/UPDATE 时查询 source event，强制它是 `inbound_message_received` 且 `account_id` 一致；应用 parser 和 reconciliation 再做相同检查。通用 Agent 产生的非入站 Message 不创建 link。

### 11.3 `/clear` 顺序与 tombstone

`/clear` 必须等待该 account/conversation 已开始的 message serialization 和 DB write barrier，再执行一个数据库事务：

1. 锁定本次将删除的 Message rows；
2. 将对应 projection links 更新为 `state=cleared`、`message_id=NULL`、写入 `cleared_at`；
3. 物理删除旧 messages；
4. 保持 Conversation Events、dispatch receipts 和 projection link tombstones 不变。

为此 `Agent.clearSession()` 扩展为允许返回 `Promise<void>`，slash handler 必须 await；Message queue 必须跟踪“尚在 serialize、已入队、正在写入”三类 per-conversation barrier，不能只观察当前数组长度。用户可见 `/clear` 回复和清理结果保持不变。

### 11.4 对账定义

经过异步 message queue 的短暂宽限期后：

- completed + outcome=`chat` 的 receipt 必须对应一条 projection link；
- link 为 `persisted` 时必须引用实际 user Message；
- link 为 `cleared` 时必须 `message_id=NULL` 且有 `cleared_at`，不报告 missing；
- completed + outcome=`command` 不应有 projection link；
- processing receipt 必须报警；
- failed receipt 可以没有 link，但必须有低基数 error code；
- Trigger、应用校验和 reconciliation 都必须拒绝 link 指向非 inbound event 或其他账号；
- event payload text 与旧 Message payload 不要求相等，因为旧路径仍会持久化 Tape/time/Visual 组装后的 prompt-shaped message。

对账首版提供 server 内部查询函数和结构化日志/metrics，不新增 Web 页面，也不自动修复 Message 或 link。

## 12. 错误处理

### 12.1 Fail closed

以下错误停止当前 batch 且不推进 cursor：

- 微信身份/时间字段非法；
- metadata schema 不通过；
- Conversation Event append 失败；
- event ID 或 idempotency 冲突；
- receipt 建立或 claim 数据库失败。

日志只记录 accountId、sourceIdentity hash、identitySource、seq、错误分类，不记录正文、context token 或 media secret。

### 12.2 业务处理失败

事实和 claim 已提交后的 chat、command、download 或 send 失败：

- 保持当前用户可见错误处理；
- receipt settle 为 failed；
- 记录稳定 error code；
- 不修改已写 Conversation Event；
- 不自动重试模型或命令；
- batch 可以推进 cursor，避免单条 poison message 阻塞后续消息。

### 12.3 Settle 失败

业务已经执行但 settle 失败时，不得在当前进程再次执行业务。batch 不推进 cursor；平台重投后 receipt 仍为 processing 并返回 skip。Phase 2 运维检查将 processing 行视为需要人工判断的异常，而不是自动 lease timeout。

### 12.4 Stuck receipt 运维恢复

Server 提供两个只操作 receipt、不读取 payload 的管理员 CLI：

```text
pnpm -F @clawbot/server ingress:stuck --older-than-seconds 300
pnpm -F @clawbot/server ingress:resolve --event-id <id> --action mark-failed --operator <name> --reason <text>
```

恢复规则：

1. `ingress:stuck` 只输出 eventId、accountId、claimedAt、identitySource、status，不输出正文或 metadata；
2. `ingress:resolve` 只允许 `processing -> failed`，错误码固定为 `operator_abandoned`；
3. operator 和非空 reason 必须写回 receipt，更新时间使用数据库时间；
4. Phase 2 禁止 `processing -> pending`、删除 receipt 或自动重跑，因为无法证明模型、命令或发送副作用尚未发生；
5. 标记 failed 后，平台对旧 cursor 的重投会 skip 该 receipt 并允许 cursor 前进；
6. 如果业务必须重做，由用户发送一条具有新平台身份的新消息，不复用旧 event ID。

这样普通 crash 不会无限静默：五分钟内报警，管理员可以安全放弃并恢复账号消息流，但不能用自动重试制造重复副作用。

## 13. Observability

新增低基数 counters：

- `weixin_ingress_identity_total{source=message_id|client_id_seq|invalid|conflict}`；
- `weixin_ingress_append_total{result=appended|duplicate|conflict|failed}`；
- `weixin_ingress_dispatch_total{result=chat|command|skipped|failed}`；
- `weixin_ingress_reconcile_total{result=linked|cleared|missing|unexpected|stuck}`。

允许 structured log 字段：accountId、eventId、streamId、seq、status、errorCode。禁止 text、payload、channel metadata、context token、AES key 和本地路径。

不把 Trace 当作事实或去重依据。

## 14. 数据库变更

新增 `20260828160000_add_weixin_ingress_phase_2` migration：

1. 创建 `weixin_ingress_dispatches`，包含 stuck recovery 审计字段；
2. 创建默认关闭的 `weixin_ingress_rollouts`；
3. 创建 `legacy_message_projection_links` 及 event/message FK、唯一键和状态 CHECK；
4. 创建 projection link Trigger，强制 source event 为 `inbound_message_received` 且 account 一致；
5. 不给 `messages` 增加 fact-ledger 专用列；
6. 不回填、不更新、不删除任何现有业务行；
7. 不修改 Phase 1 append-only trigger；
8. migration 必须在 `20260828120000_add_fact_ledger_phase_1` 之后部署。

这是 expand-only migration。生产部署前必须先单独执行并确认 Phase 1 migration，再部署 Phase 2 应用。

## 15. 测试设计

### 15.1 SDK 单元/业务测试

- 有效微信字段生成 `ValidatedWeixinInbound`；
- 缺失/空 `client_id`、sender、非法 seq/time 被拒绝；
- accept 在 slash detection、媒体下载和 agent.chat 之前调用；
- disposition=`skip` 时命令、chat、下载、发送均不发生；
- `/clear` 仍清会话、发原确认文本且不调用模型；
- `onSyncBufUpdate` 被 await，失败时内存 cursor 不前进；
- batch 后部失败重投时，前部 completed receipt 不重复执行。

### 15.2 Server mapper 纯单元测试

- event ID、idempotency key 对同一 account/client 稳定；
- 不同账号隔离；
- platform seq 不成为 streamSeq；
- canonical text 不含 quoted 展示前缀；
- voice platform transcription 与纯媒体空文本映射正确；
- attachment refs 稳定且保持 item 顺序；
- metadata v1 精确映射允许字段；
- context token、secret、local path 和派生上下文字段无法进入 metadata；
- mapper 输出通过 Agent Append Input parser。

### 15.3 Disposable PostgreSQL 集成测试

- 首次 ingress 产生一个 Conversation Event 和一个 processing receipt；
- 同一 clientId 并发 accept 只产生一条事实和一次 claim；
- 事实写入后、receipt 创建前模拟失败，重投能补建 receipt；
- completed/failed/processing receipt 重投均不重新 claim；
- Message source link 唯一且 FK 有效；
- command receipt 不要求 Message link；
- reconciliation 正确报告 linked、missing、unexpected、stuck；
- UPDATE/DELETE event 仍被拒绝，receipt 可以按状态机更新；
- append/receipt 失败时 sync cursor store 未被调用。

### 15.4 回归测试

继续通过：

- Phase 0 微信业务基线；
- Agent、Server、微信 SDK 全量测试与 typecheck；
- Agent layer check；
- Phase 1 PostgreSQL 集成测试；
- Prisma validate、migration fresh deploy 和 migration status。

## 16. Rollout 与回滚

### 16.1 上线顺序

1. 在 disposable PostgreSQL fresh deploy 全部 migration；
2. 部署生产 Phase 1 migration；
3. 部署 Phase 2 expand-only migration；
4. 部署支持 lifecycle hook 但未启用账号 ingress 的应用版本；
5. 以账号 allowlist 启用 ledger ingress；
6. 观察 append、dispatch、stuck 和 reconciliation 指标；
7. 扩大到全部账号。

Phase 2 使用 `weixin_ingress_rollouts` 账号表，不使用进程环境变量作为长期配置。默认关闭；未启用账号继续旧路径，启用账号必须 fail closed，不能在 append 失败后静默回退到无账本处理。

### 16.2 应用回滚

将账号 rollout 行设为 disabled 并 restart 该账号后回到旧路径。已写事实和 receipt 保留，不删除。nullable Message source column 不会影响旧应用。

### 16.3 停止条件

出现以下任一情况停止扩量：

- duplicate receipt 仍触发两次 chat/command；
- append 失败后仍推进 sync cursor；
- ledger text 出现 SDK quoted 前缀、Tape、时间或 Vision fallback；
- metadata 出现 context token、CDN/AES secret 或本地路径；
- chat receipt 长期缺少 Message source link；
- processing receipt 持续增长；
- Phase 0 用户可观察行为变化。

## 17. 验收标准

Phase 2 完成必须同时满足：

1. 所有有效微信 ingress 在任何业务处理前写入 Conversation Event；
2. SDK 校验 `client_id`、seq、sender 和发生时间；
3. server adapter 独占微信 metadata schema 和 canonical mapping；
4. 重复 ingress 不重复启动 chat、命令或发送；
5. append/claim 失败不推进持久化 sync cursor；
6. canonical text 保持来源纯净，旧 ChatRequest 行为不变；
7. 媒体事实先于下载，且不泄漏下载秘密；
8. chat ingress 与旧 user Message 可通过 source event 精确关联；
9. command、failed、stuck receipt 可明确区分；
10. 所有新增 migration 均 expand-only；
11. 生产读取仍来自旧 messages/Tape 路径；
12. Phase 0 与 Phase 1 全部回归和 DB 集成测试通过。

## 18. 预计文件范围

### Weixin SDK

```text
M packages/weixin-agent-sdk/src/api/types.ts
M packages/weixin-agent-sdk/src/agent/interface.ts
A packages/weixin-agent-sdk/src/messaging/inbound-validation.ts
M packages/weixin-agent-sdk/src/messaging/process-message.ts
M packages/weixin-agent-sdk/src/monitor/monitor.ts
M packages/weixin-agent-sdk/index.ts
M packages/weixin-agent-sdk/test/process-message.business.test.ts
A packages/weixin-agent-sdk/test/inbound-validation.test.ts
A packages/weixin-agent-sdk/test/monitor-ingress-lifecycle.test.ts
```

### Server

```text
A packages/server/src/weixin/inbound-mapper.ts
A packages/server/src/weixin/inbound-mapper.test.ts
A packages/server/src/weixin/ingress-controller.ts
A packages/server/src/weixin/ingress-controller.test.ts
A packages/server/src/db/weixin-ingress-dispatch-store.ts
A packages/server/src/db/weixin-ingress-dispatch-store.test.ts
A packages/server/src/db/weixin-ingress-rollout-store.ts
A packages/server/src/db/weixin-ingress-rollout-store.test.ts
A packages/server/src/db/fact-ledger-reconciliation.ts
A packages/server/src/db/fact-ledger-reconciliation.test.ts
M packages/server/src/runtime.ts
M packages/server/src/agent.ts
M packages/server/src/db/messages.ts
M packages/server/src/db/message-store.impl.ts
M packages/server/prisma/schema.prisma
A packages/server/prisma/migrations/20260828160000_add_weixin_ingress_phase_2/migration.sql
A packages/server/test-integration/weixin-ingress-phase-2.test.ts
```

### Agent

```text
M packages/agent/src/engine/turn.ts
M packages/agent/src/ports/message-store.ts
M packages/agent/test/engine/chat-engine.test.ts
```

### Observability

```text
M packages/observability/src/metrics/agent-metrics.ts
M packages/observability/src/metrics/index.ts
M packages/observability/src/index.ts
```

## 19. Phase 3 入口

Phase 2 验收后，Phase 3 只能从 Conversation Events 构建 shadow canonical context。Phase 3 不得读取微信 metadata、dispatch receipt 或旧 `messages.payload` 来补充标准上下文字段。

在启动 Context Compiler 前，必须单独确定并落成 `/clear`/session boundary 的事实语义，以及 attachment source ref 到 immutable media Artifact 的解析边界。二者不能通过解析用户文本或展开 channel metadata 临时绕过。
