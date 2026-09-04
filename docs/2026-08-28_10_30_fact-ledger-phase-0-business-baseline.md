# 事实账本 Phase 0：业务行为基线与契约

> 状态：Implemented / 待审查
> 日期：2026-08-28
> 范围：只冻结业务行为并定义 v1 契约，不接入事实账本，不修改生产读写路径。

## 1. 测试原则

Phase 0 测试从业务边界描述系统：

- 用户或平台给了什么输入；
- Agent 和模型实际看到了什么；
- 会话重启后恢复了什么；
- 用户最终收到或没有收到什么；
- 哪些事实能够进入后续的历史、审计和记忆。

测试不固定私有 helper 的调用次数、内部队列实现、文件拆分方式或 Prisma 查询写法。只要业务结果不变，后续重构可以自由调整实现。

## 2. 当前行为基线

| 业务场景 | 当前可观察行为 | 覆盖位置 |
| --- | --- | --- |
| 普通聊天 | 用户输入与 Assistant 回答都会进入会话历史 | `agent/test/engine/chat-engine.test.ts` |
| 运行时上下文 | 当前时间和 Tape memory 与用户原文拼接后一起交给模型并持久化 | `agent/test/acceptance/current-conversation-business.test.ts` |
| 冷启动与模型切换 | 新模型恢复并继续使用旧模型形态的 transcript | `agent/test/acceptance/current-conversation-business.test.ts` |
| 图片 fallback | chat 模型不能看图且无 Vision 模型时，fallback 和 replacement text 进入永久消息历史 | `agent/test/acceptance/current-conversation-business.test.ts` |
| 工具任务 | 一次任务形成 Assistant tool call、tool result 和最终 Assistant 回答 | `agent/test/acceptance/current-conversation-business.test.ts` |
| 微信入站 | Agent 当前只能收到 conversationId、正文、媒体和 context token，收不到平台消息身份及发生时间 | `weixin-agent-sdk/test/process-message.business.test.ts` |
| 清除会话 | `/clear` 清除对应会话、回复用户确认，并跳过模型调用 | `weixin-agent-sdk/test/process-message.business.test.ts` |
| 投递失败 | Agent 已经生成回答后，微信发送失败不会形成返回 Agent 的送达确认 | `weixin-agent-sdk/test/process-message.business.test.ts` |
| Scheduler | 任务在隔离会话执行，结果推送到真实目标会话 | `agent/test/capabilities/scheduler/executor.test.ts` |
| Heartbeat | 主动开口通过真实会话执行，并受静默、间隔及每日上限约束 | `agent/test/heartbeat/engine.test.ts`、`agent/test/heartbeat/evaluator.test.ts` |
| 上下文裁剪 | tool call/result 不会被裁剪成孤立消息 | `agent/test/engine/conversation/context-window.test.ts` |

## 3. v1 事实契约

契约位于 `packages/agent/src/shared/fact-ledger/`，包含：

- Conversation Event；
- Agent Run Event；
- Memory Event；
- Artifact Revision；
- Context Manifest；
- 当前 schema version 和未知版本拒绝策略。

契约的业务约束：

1. 入站消息 payload 只允许平台原始文本、附件引用、发送者快照、回复关系和 channel metadata；
2. Tape、effective time、Visual observation 和 provider message 不能作为入站消息字段；
3. `delivery_failed` 是 Run Fact，不等于 `outbound_message_delivered`；
4. Memory assertion 必须引用来源会话事件，模型抽取还应引用模型和 Prompt revision；
5. Artifact 必须在 inline JSON 和外部 storage reference 中二选一；
6. 未知 schema version 必须显式失败，不能按当前版本静默解析。

补充约束：

- `channelMetadata` 是通用、版本化的 opaque JSON 信封；核心只校验 `schemaId`、`schemaVersion`、JSON 可序列化性，不维护平台字段白名单；
- `schemaId` 的具体取值和 `data` schema 由渠道 adapter 拥有；微信协议原始校验属于 `weixin-agent-sdk`，Conversation Event 映射和 metadata 校验属于 server 微信 adapter；
- metadata 仅用于来源审计，不属于上下文输入；Context Compiler、Memory Extractor 和模型请求构建必须只显式读取标准字段，不得展开 payload 或读取 metadata；
- 防逃逸依靠可信 adapter 的写入权和消费者不读取的不变量，而不是核心字段名黑名单；
- user/agent actor 必须包含主体 ID，system actor 可以省略；
- Artifact SHA-256 统一使用小写十六进制；Artifact 自身的 `schemaVersion` 是内容版本，不等同于事实账本契约版本；
- `skill_loaded` 在 v1 中只表示 `use_skill` tool call 触发的渐进式披露，因此必须关联 tool call；always-on 和显式配置技能只进入 Context Manifest 的 skill revision 列表。

### 投递失败的两层事实

每次失败投递首先追加 `AgentRunEvent.delivery_failed`，记录本次执行尝试、错误和重试属性。

只有平台明确确认失败，并且这个外部结果需要进入会话边界时，才额外追加 `ConversationEvent.outbound_message_delivery_failed`。后者不能投影为用户已收到的消息，也不能替代 Run Fact 的完整执行证据。

注意：“原文纯净”不通过搜索 `<memory>` 或 `[当前时间]` 等字符串实现。用户完全可能主动输入这些文本；纯净性的含义是系统不得额外增加派生字段或改写 `payload.text`。

## 4. 上下文重建验收样例

### 历史重放

历史重放使用原 Context Manifest，固定：

- conversation/run event IDs；
- memory watermark；
- Visual observation；
- Model、Prompt、Skill、Tool revisions；
- effective time；
- trim decision；
- canonical request hash。

### 反事实重编译

反事实重编译复用同一批事实及 memory watermark，但生成新的 manifest，并允许选择新的模型、Prompt、Skill、Tool、policy、effective time 和 request hash。旧 manifest 不得被修改。

对应验收测试位于 `agent/test/fact-ledger/context-rebuild-scenarios.test.ts`。

## 5. Phase 0 明确不做

- 不新增 Prisma 表或 migration；
- 不新增账本 Store Port；
- 不双写 Conversation/Run/Memory Events；
- 不实现 Context Compiler；
- 不修改 `MessageStore`、Tape、Vision、微信发送和 Web 查询逻辑；
- 不尝试清洗或回填旧 `messages.payload`。

## 6. 进入 Phase 1 的门槛

- Agent、Server 和微信 SDK 的类型检查通过；
- Agent、Server 和微信 SDK 的测试通过；
- Agent 分层检查通过；
- v1 契约和重建样例经审查确认；
- Agent 契约测试证明核心接受至少两个虚构渠道各自的 metadata schema；
- diff 中不存在生产行为切换。

## 7. 后续阶段必须补齐的读取边界测试

- Phase 2 微信 adapter 测试覆盖协议字段映射，并拒绝渠道 schema 外的派生上下文字段；
- Phase 3 Compiler 测试证明仅 metadata 不同时 canonical request 完全相同；
- Phase 3 Memory Extractor 测试证明仅 metadata 不同时抽取输入完全相同。
