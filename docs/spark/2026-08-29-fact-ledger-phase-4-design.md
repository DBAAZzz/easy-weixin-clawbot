# Fact Ledger Phase 4：Run Ledger 与正式 Context Manifest

> 状态：设计完成 / 可进入实施
> 日期：2026-08-29
> 前置：Phase 3 session boundary、Context Compiler shadow mode 与 disposable PostgreSQL 集成测试已通过
> 范围：把 Phase 1 已建模但从未写入的 Agent Run Event 落进生产 chat 路径，补齐 outbound 投递事实，固化 Prompt/Skill/Tool/Model revision 制品，并在首次模型调用前持久化正式 Context Manifest；Phase 4 仍然是 expand-only 写侧阶段，不切换生产读取源

## 1. 决策摘要

Phase 4 采用以下方案：

1. Run Ledger 只接入微信 ingress chat run（拥有 `sourceConversationEventId` 的实时聊天），与 Phase 3 shadow 同范围；scheduler、heartbeat、API chat、主动推送、标题生成、记忆抽取 lane 均不接入；
2. runId 从 source receipt 确定性派生（`run-v1:<sha256(accountId + NUL + sourceEventId)>`），使 server 在 settle 阶段无需传递即可补写 delivery 事件；重投不可能产生重复 run（Phase 2 claim 语义保证）；
3. 每个审计点（模型调用、工具调用、技能加载）的正文进入内容寻址 Artifact；`manifest + run_started + context_compiled` 三个写入在首次模型调用前同步 await 完成，其余 run 事件经 per-run 串行异步队列写入，失败一律 fail-open（指标 + 日志），绝不阻塞生产 turn；
4. 投递事实通过扩展 SDK settle 携带投递报告落账：`delivery_requested` 在响应返回前写入，`delivery_succeeded/failed` 与 `outbound_message_delivered/delivery_failed` 在 settle 时写入，后者记录实际发送的渠道文本；
5. Canonical Context 通过新的 `context-policy-v2` 启用 run facts：assistant/tool entries 来自终态 run 的 Run Events（模型原始输出），`outbound_message_delivered` 在 v2 下不再是 entry 而是渠道侧审计事实；v1 policy 行为完全不变，两者以 result PK 隔离并存；
6. 正式 Context Manifest 每 run 一个，以制品形式在模型调用前持久化，并被 `context_compiled` 与每个 `model_call_started` 引用；
7. Phase 4 不切换生产读取源。切换硬门禁是 coverage 全开（memory facts 仍在 Phase 5）加 shadow 收敛，见 §22。

## 2. 目标

Phase 4 完成后，系统具备下面的并行链路：

```text
Chat turn (ingress, run ledger enabled)
  -> runId derived from source receipt
  -> run_started appended (inline)
  -> compile canonical context (policy v2: conversation facts + prior terminal runs)
  -> pin prompt/skill/tool/model revisions as artifacts
  -> put CONTEXT_MANIFEST artifact (inline, before round 1)
  -> context_compiled appended (inline)
  -> AgentRunner loop, per round/call/tool:
       model_call_started -> generateText -> model_call_completed | model_call_failed
       tool_call_requested -> execute -> tool_call_completed | tool_call_failed
       use_skill -> skill_loaded
       (all async queued, ordered by per-run queue)
  -> run_completed | run_interrupted
  -> delivery_requested
  -> SDK sends reply -> settle carries delivery report
  -> delivery_succeeded | delivery_failed
  -> outbound_message_delivered | outbound_message_delivery_failed (channel truth)
```

必须满足：

1. Run Event 的写入顺序与逻辑顺序一致（per-run 串行），`runSeq` 仍由 Store 分配；
2. 同一 receipt 重投不产生第二个 run、不重复任何 run event；
3. manifest 存在性先于第一次 `generateText`：崩溃窗口内不存在"已调用模型但 manifest 未落"的可提交状态（写入失败时整个 run 不记录，见 §15）；
4. run facts 的纳入是确定性的：只包含以 `run_completed` 终态的 run（zombie 与 interrupted run 一律排除），compiler 输出由编译输入唯一决定；
5. Run Ledger / artifact / manifest 写入失败不阻塞模型调用、回复发送、receipt settle 和 sync cursor，只产生指标与结构化日志；
6. 制品内容寻址与全局去重遵循 Phase 1 语义（`getByContent` 命中即复用）；
7. Phase 3 的 v1 policy 编译结果语义逐字节不变，已有 v1 shadow result 不受影响；
8. diff 固定类别不新增，`unclassified_difference` 继续收敛到零。

## 3. 非目标

Phase 4 不做：

- 将生产聊天读取切换为 canonical context / manifest（生产读取仍来自旧 Message/Tape）；
- Memory Event 写入与 Tape 迁移（Phase 5）；
- Vision observation 与媒体 immutable Artifact 映射（Phase 5）；
- Provider wire request 抓取（AI SDK 抽象层之下，留待重放验证阶段）；
- scheduler / heartbeat / API chat / 主动推送 run 的 ledger 接入；
- 标题生成、记忆抽取、pulse eval 等辅助 LLM lane 的接入；
- summary/compaction 制品化（Phase 5）；
- Manifest 的历史重放执行器或审计读取 API；
- 将 run event 写入失败升级为 fail-closed（那是读取切换阶段的行为）；
- Web UI 与公开 HTTP API。

## 4. 方案比较

### 4.1 方案 A：Run Recorder 放在 Server，agent 通过回调上报

Server 侧集中写库的好处是离资产服务近。但 run 事件产生于 agent 引擎循环内部（每轮、每次工具调用），跨进程回调会把引擎执行顺序泄露到 IPC 边界上，且 agent 包将事实上依赖 server 的存在。违背 Port/Adapter 边界。

不采用。

### 4.2 方案 B：production 读取直接切到 manifest（Phase 4 一步到位）

切换意味着 memory facts（Tape）必须同期迁移或降级丢弃，Phase 4 的爆炸半径从"新增写路径"扩大到"重写读路径"。与 Phase 0-3 一贯的 expand → 验证 → 切换节奏冲突。

不采用。

### 4.3 方案 C：expand-only 的 Run Ledger + 正式 Manifest + policy v2（采用）

生产路径照旧，ledger/manifest 作为并行写路径以 fail-open 方式落地；canonical context 通过 policy revision 版本化扩展 run facts；shadow diff 继续验证。Phase 5 补齐 memory/media 后，读取切换只剩一个硬门禁检查。

采用。

## 5. Run Ledger 语义

### 5.1 范围与 runId

接入条件（同时满足）：

- 账号启用 `run_ledger_rollouts`（§19）；
- 本次 turn 是 ingress chat，即 `ChatTurnInput.sourceConversationEventId` 存在。

runId 确定性派生：

```text
runId = run-v1:<sha256(accountId + NUL + sourceEventId)>
```

- settle 阶段 server 仅凭 receiptId 即可派生 runId，补写 delivery 事件；
- receipt 重投在 Phase 2 已被 claim 语义挡下（`createAndClaim` 返回 false → skip），因此同一 runId 不会对应两次 turn 执行；
- 管理员 repair 等异常路径若导致重执行，run event 以确定性 eventId 幂等（§5.4）。

`RunContext` 新增可选字段 `runId?: string`，由 turn 层赋值；runner 与工具上下文透传。

### 5.2 事件清单与写点

| 事件 | 写点 | 同步性 | 关键 payload |
|---|---|---|---|
| `run_started` | turn 进入 withConversation 后、编译前 | inline await | `runKind:"chat"`, `triggerEventId = sourceEventId` |
| `context_compiled` | manifest 制品 put 成功后 | inline await | `manifestId` |
| `model_call_started` | 每轮 `generateText` 前 | async queue | `callId`, `round`, `manifestId`, `requestArtifactId?` |
| `model_call_completed` | 每轮成功后 | async queue | `callId`, `responseArtifactId`, `stopReason` |
| `model_call_failed` | 每轮抛错后（含 abort 除外） | async queue | `callId`, `error`（稳定 code，非原始 message） |
| `tool_call_requested` | 工具执行前 | async queue | `toolCallId`, `toolName`, `toolRevisionId`, `argumentsArtifactId` |
| `tool_call_completed` | 工具成功后 | async queue | `toolCallId`, `resultArtifactId` |
| `tool_call_failed` | 工具抛错后 | async queue | `toolCallId`, `error`, `errorArtifactId?` |
| `skill_loaded` | `use_skill` 成功加载后 | async queue | `skillName`, `skillRevisionId`, `round`, `causationToolCallId` |
| `run_completed` | turn 业务成功结束（`completed`/`max_rounds` 且未回滚） | async queue | `rounds`, `finalResponseArtifactId?` |
| `run_interrupted` | abort / throw / user-message rollback 结束 | async queue | `reason`（`aborted` / `turn_rolled_back` / 稳定 error code） |
| `delivery_requested` | 响应返回 SDK 前（turn 级 await，见下） | inline await | `deliveryId`, `responseArtifactId` |

事件信封统一：

```text
eventId:    确定性，见 §5.4
causationId: run_started 为 sourceEventId；其余为直接前因（callId / toolCallId / deliveryId）
correlationId: 全部事件 = sourceEventId（与 Conversation Event 侧一致，可互查）
```

`error` 字段只允许稳定错误码（如 `model_timeout`、`tool_not_found`），禁止原始异常 message——两者都可能携带正文或 secret。已有错误必须有映射，未知错误统一 `internal_error`。

### 5.3 runSeq 与顺序

- `runSeq` 仍由 `AgentRunStore.append()` 经 run head 分配（Phase 1 语义），recorder 不自行编号；
- recorder 内部维护 per-run FIFO 串行队列：每个 append 等待前一个完成，保证"先 requested 后 completed"、"先 run_started 后一切"的逻辑顺序在数据库中成立；
- inline 写（§5.2 前三行与 `delivery_requested`）同样是队列任务，只是 turn 会 `await` 它：队列 FIFO + 每个任务等待前一个 append 完成，保证 awaited 与 queued 任务共用同一全序；
- `delivery_requested` 必须在响应返回前完成 append——这是 settle 侧（进程内直接 append，不经 recorder）能够安全补写 `delivery_succeeded/failed` 的前提：settle 到达时，该 run 在 `delivery_requested` 之前的全部事件已落库，runSeq 单调性不会被打乱；
- run 的业务终态由 **turn 层**决定而非 runner：runner 返回 `completed` 但 `handleRunResult` 发生 user-message rollback 时记 `run_interrupted{reason:"turn_rolled_back"}`；`aborted` 记 `run_interrupted{reason:"aborted"}`；抛错记 `run_interrupted{reason:<稳定 code>}`。只有未回滚的 `completed`/`max_rounds` 记 `run_completed`。该规则使 run 终态与 legacy 历史的实际留存一致（回滚 turn 不留任何消息）。

### 5.4 确定性 eventId 与幂等

Run Event v1 无业务幂等键（Phase 1 §11.3 的决策），Phase 4 用确定性 eventId 承担重试语义：

```text
eventId = run-event-v1:<sha256(accountId + NUL + runId + NUL + kind + NUL + localKey)>
```

`localKey` 举例：`run_started`/`context_compiled` → `"1"`；`model_call_started/completed` → `callId`（callId = `call-v1:<sha256(runId + NUL + round)>`）；`tool_call_*` → `toolCallId`；`skill_loaded` → `causationToolCallId`；`delivery_*` → `deliveryId`。

- 同一输入重放得到同一 eventId → Store 的 id-retry 语义返回已存事件（`appended:false`），不产生重复；
- `localKey` 冲突（同 runId 同 kind 同 localKey 但内容不同）抛 `FactLedgerIdConflictError`，按 fail-open 记指标。

### 5.5 失败语义（fail-open）

- 任一 append / artifact put 失败：recorder 标记本 run 为 `degraded`，丢弃后续入队事件，发 `run_ledger_total{result=degraded}` 与结构化日志（仅 accountId、runId、errorCode）；
- degraded run 必须**尽力补写终态标记** `run_interrupted{reason:"ledger_degraded"}`（本身也是 best-effort，失败则维持 zombie 形态）。这使两类异常可区分：
  - `ledger_degraded` 终态的 run = 进程内 ledger 降级，属 fail-open 的合法产物，由指标计数，对账不报警；
  - 无任何终态事件的 run = 进程崩溃级异常，才进入 `zombie_run` 对账观测（§14）；
- 附带效应：degraded run 按 §10.2 规则被 canonical 编译整体排除——部分记录的 run 本就不应产生 entries（缺失 tool_call 事件会产生未配对 entry），排除是保守且确定性的选择；
- degraded run 的生产路径完全不受影响；已写入的事件保留；
- `run_started` 失败即整 run 不记录（后续事件全部依赖它），同样只记指标。

## 6. Outbound 投递事实

### 6.1 deliveryId

```text
deliveryId = delivery-v1:<sha256(accountId + NUL + sourceEventId)>
```

每个 ingress chat 回复一个 delivery；一次回复内的文本与媒体（SDK 可能发多条平台消息）合并为一个投递事实。多消息拆分细节不进入 v1 账本。

### 6.2 SDK settle 扩展

`ProcessMessageOutcome` 从字符串联合升级为对象：

```ts
interface ProcessMessageOutcome {
  status: "chat" | "command" | "failed";
  errorCode?: string;
  delivery?: {
    ok: boolean;
    channelMessageId?: string;   // SDK 发送成功后返回的 clientId
    error?: string;              // 平台失败摘要（不含正文）
  };
}
```

- `process-message.ts` 在发送回复处收集：任一平台消息发送失败 → `ok:false`；全部成功 → `ok:true`，`channelMessageId` 取最后一个 clientId；
- 同时携带 `textSent`（实际发送的转换后文本）与 `delivery` 一起经 `settle` 上报：

```ts
settle(input: {
  receiptId: string;
  outcome: ...;
  errorCode?: string;
  deliveryReport?: {
    ok: boolean;
    channelMessageId?: string;
    textSent?: string;
    error?: string;
  };
}): Promise<void>;
```

`/clear` 等 command outcome 不携带 deliveryReport；失败 outcome 的 error notice 发送不计为 delivery。

### 6.3 Server settle handler

前置判断：settle 凭确定性 eventId 直接查询 `delivery_requested` 是否存在（`AgentRunStore.getById`，id 见 §5.4）。

- **存在**（正常 run）：按顺序执行（都失败可重试，幂等由确定性 eventId 保证）：
  1. `delivery_succeeded` / `delivery_failed` run event（causationId = deliveryId）；
  2. 成功时 `outbound_message_delivered` conversation event：`streamId = source.streamId`、`causationId = sourceEventId`，payload 按契约含 `deliveryId`、`channel:"weixin"`、`text = textSent`（渠道真实发送的文本）、`attachmentRefs = []`（媒体 artifact 关联是 Phase 5），`channelMessageId` 取报告中的 clientId；
  3. 失败时 `outbound_message_delivery_failed`：`reason` 为稳定 code，`retryable:false`。
- **不存在**（run 已 degraded，`delivery_requested` 因 §5.5 降级未写）：跳过 delivery **run events**——不产生缺少 `delivery_requested` 的残缺 run 链——但 **`outbound_message_delivered`/`outbound_message_delivery_failed` conversation fact 照写不误**：平台投递是独立于 run ledger 健康度的事实，缺失它对未来编译的损害远大于 run 链不完整。

明确：`outbound_message_delivered.text` 与 run 原始输出可以不同（markdown→纯文本渠道转换），这是预期而非错误，一致性由对账校验"前缀等价"而非全等（§14）。

### 6.4 非聊天路径

主动推送（pulse/proactive push）在 Phase 4 既不产生 run event 也不产生 outbound 事实，它们在 canonical 侧的缺席由既有 `legacy_only_assistant_entry` 类别吸收，属于已解释差异（§12）。

## 7. Revision 制品

每 run 在编译后、manifest 前固化以下内容寻址制品（全部 inline，`getByContent` 命中即复用，不重复 put）：

| 种类 | 内容文档 | artifactId |
|---|---|---|
| `PROMPT_REVISION` | `{ key, body }`（chat lane 的 systemPromptKey 资产，变量已解析） | `prompt-revision-v1:<sha256(body)>` |
| `SKILL_REVISION` | `{ name, version, body }` | `skill-revision-v1:<sha256(name + NUL + body)>` |
| `TOOL_REVISION` | `{ name, description, parameters, handler }` | `tool-revision-v1:<sha256(canonicalize(doc))>` |
| `MODEL_CONFIG_REVISION` | `{ provider, modelId, purpose, contextWindow, maxOutputTokens }` | `model-config-revision-v1:<sha256(canonicalize(doc))>` |

- 技能范围：always-on 技能 + 从历史恢复的已加载技能 + 本 run `use_skill` 新加载的技能（后者在加载时补 put）；
- 工具范围：`tools.current()` 全量（含 `use_skill` 内建工具的描述与 schema）；
- 工具 md 的 `version` frontmatter 不直接进 id（ToolCatalogItem 未暴露），内容哈希已足够表达"定义未变"；
- 制品 put 失败按 §5.5 降级，manifest 中的 revision id 字段以实际成功 put 的为准；任一 revision 失败则本 run 不写 manifest（无 manifest 的 run 是 degraded run，不是带空洞 manifest 的 run）。

## 8. 请求/响应/工具制品

| 种类 | 内容文档 | 大小策略 |
|---|---|---|
| `CANONICAL_REQUEST` | `{ schemaVersion:1, runId, round, modelRevisionId, system, messages, tools, trim }`（即该次调用真正发出的模型可见输入，含 trim 后的 history） | ≤ 256 KiB inline，否则 `ArtifactContentSink` |
| `MODEL_RESPONSE` | 序列化 assistant message（原始输出，未经 sanitize） | 同上 |
| `TOOL_ARGUMENTS` | `toolCall.arguments` JSON | inline |
| `TOOL_RESULT` | tool result content | 同 CANONICAL_REQUEST |

- 所有文档先算 `sha256CanonicalJson` 再存储；`artifactId = <kind 蛇形>-v1:<sha256>` 前缀 + 内容哈希，内容变化即新制品；
- `ArtifactContentSink`（新 Port，§11）只负责把超限字节落到 server 资产存储并返回 `{provider, key}`；制品行仍由 `ArtifactRevisionStore.put` 记录；
- 超限且 sink 失败 → §5.5 降级；
- 制品内容不做 sanitize：账本是访问受控的内部事实，日志侧继续 sanitize（§16）。

## 9. Context Manifest V1

### 9.1 时机与身份

```text
run_started (inline)
  -> compile canonical context (policy v2)
  -> pin revisions (§7)
  -> round-1 canonical request 文档构建 + hash
  -> CONTEXT_MANIFEST artifact put
  -> context_compiled { manifestId }
  -> round-1 model_call_started { manifestId, requestArtifactId }
  -> generateText
```

manifestId 确定性派生（内容寻址不可用——内容含自身 id 的哈希字段，且 runId 已保证唯一）：

```text
manifestId = context-manifest-v1:<sha256(accountId + NUL + runId)>
```

CONTEXT_MANIFEST 制品的 `artifactId = manifestId`，`inlineJson` 为 manifest 文档本体。

### 9.2 字段语义（对照 Phase 1 `contextManifestSchema`）

| 字段 | Phase 4 取值 |
|---|---|
| `conversationEventIds` | 编译窗口内全部 conversation event id（含 boundary 与非 entry 事件） |
| `runEventIds` | 成为 entry 来源的**先前** run 的事件 id（本 run 自身事件发生在 manifest 之后，天然不在内） |
| `summaryArtifactIds` | `[]`（compaction 制品化在 Phase 5） |
| `memoryEventWatermark` | 常量 `"unavailable-v1"`（Memory Event 在 Phase 5） |
| `memoryArtifactId` | 不设 |
| `visualObservationIds` | `[]` |
| `modelRevisionId` / `promptRevisionId` | §7 制品 id |
| `skillRevisionIds` | 编译时已加载技能（§7 范围；run 中新加载的由 `skill_loaded` 事件补录，manifest 不回填） |
| `toolRevisionIds` | §7 全量工具 |
| `effectiveTime` / `timezone` | 与编译输入一致（同一 `effectiveTime` 贯穿 legacy、shadow、manifest） |
| `trimDecision` | round-1 trim 结果：`{ trimLevel, originalTokens, trimmedTokens, droppedMessages, fixedOverheadTokens }` |
| `canonicalRequestHash` | round-1 CANONICAL_REQUEST 文档哈希（文档可因超限只记录哈希不落制品） |
| `providerRequestArtifactId` | 不设（provider wire request 抓取不在 Phase 4） |

轮次 2+ 的输入不回填 manifest；它们以各自 `model_call_started.requestArtifactId` 链接，可从 manifest 出发沿 run events 完整重建每次调用的输入。

round-1 的 trim 原本发生在 runner 循环内；Phase 4 要求 manifest 在 round-1 调用前落库，因此 round-1 的 trim 计算（`fitToContextWindow` 纯函数）提前到 manifest 构建之前执行一次，runner 首轮复用该结果，不再重复计算。

### 9.3 Round-1 请求文档的同源硬规则

canonical request 文档描述的是**实际发出的模型输入**：system prompt、trim 后的模型可见 history（含 Tape 注入后的 user message——这是现实，manifest 不假装它来自 canonical facts）、工具 schema 与 trim 结果。为杜绝"manifest 一套、runner 实跑另一套"：

1. 抽取引擎级纯函数（如 `buildRoundRequest(round, deps)`）：输入为 base prompt、skills 快照、workingHistory、model meta 与工具列表，输出 `{ system, messages, tools, trim }` 及其序列化文档；runner 每轮与 manifest 构建都调用它——round-1 由 turn/recorder 先调用一次用于 manifest，runner 首轮复用同一结果，round-2+ 由 runner 内调用；
2. 该函数是唯一允许生成 canonical request 文档的代码路径；禁止在 manifest 侧重新实现 trim/prompt 组装；
3. 测试必须断言：`manifest.canonicalRequestHash === runner 实际 round-1 请求文档 hash`（recorder 保存的文档与 runner 发出的输入做深比较），并作为 §17.2 的固定用例。

### 9.4 契约扩展（v1 内可选字段，无版本 bump）

`model_call_started` payload 增加可选 `requestArtifactId`。Run Event 目前零生产数据，直接修正 Phase 1 契约即可；旧读取方忽略新字段，无兼容负担。除此之外不修改任何事实账本 schema。

## 10. Canonical Context：context-policy-v2

### 10.1 policy 即开关

`contextPolicyRevisionId` 从 `context-policy-v1` 扩展出 `context-policy-v2`：

- v1：仅 conversation facts（Phase 3 已固化的行为，逐字节不变；由 v1 快照回归锚与既有 v1 shadow result 覆盖）；
- v2：conversation facts + prior terminal run facts。

policy 是编译输入身份的一部分，v1/v2 的 shadow result 以 `(source_event_id, compiler_version, context_policy_revision_id)` PK 天然隔离并存。`compilerVersion` 保持 `context-compiler-v1` 不变。

### 10.2 run-facts reducer（新纯函数，L3）

```ts
interface RunFactWindow {
  runs: Array<{
    runId: string;
    triggerEventId: string;
    triggerStreamSeq: number;
    terminal: true;
    entries: Array<RunDerivedEntry>;
  }>;
}
```

纳入规则（全部满足才产生 entries）：

1. `run_started.conversationStreamId` 等于编译 stream，且 `triggerEventId` 位于编译窗口（boundary, cursor] 内；
2. run 以 `run_completed` 终态（业务成功，含 `max_rounds`）。`run_interrupted` 终态的 run **整体排除**——包括其中已完成的 `model_call_completed`/`tool_call_completed`——与 legacy 回滚/取消后不留任何消息的行为对齐；崩溃遗留的 zombie run（无终态事件）同样永远排除，确定性不受影响；
3. 输入顺序无关：reducer 按 `(triggerStreamSeq, runId, runSeq)` 排序后输出。

派生 entries：

- 每个终态 run 的每轮 `model_call_completed` → 一条 assistant entry，`text` 取 MODEL_RESPONSE 制品文本（制品缺失时降级为空文本并记 diagnostic `run_response_artifact_missing`），含 tool-call 的中间轮同样成 entry（text 可为空；legacy 持久化层会跳过空 assistant 消息，canonical 保留完整 run 链以维持 tool-call 配对，切换后以 canonical 为准）；
- 每个 `tool_call_completed` → 一条 tool entry，`text` 取 TOOL_RESULT 制品文本（缺失时同样降级 + diagnostic）；
- `tool_call_failed` 同样产生一条 tool entry：recorder 在失败时把错误结果内容（isError 标记内嵌文档）put 为 TOOL_RESULT 制品并记入 `errorArtifactId`，entry 文本取自该制品——legacy 历史包含错误工具结果（回灌模型），canonical 必须一致；制品缺失时降级为空文本 + diagnostic；
- `model_call_failed` 与 run 终态事件本身不产生 entry；`model_call_failed` 只会出现在被 `run_interrupted` 排除的 run 中（模型调用失败即 run 失败），因此对 entries 无影响。

### 10.3 entry 类型扩展（加法，不改变 v1 含义）

```ts
interface CanonicalConversationEntryV1 {
  // 既有字段不变；
  // run 派生 entry 携带：
  runId?: string;
  runSeq?: number;       // 对应 run event 的 runSeq
  callId?: string;
}
```

- conversation 派生 entry 的 `eventId` = conversation event id；run 派生 entry 的 `eventId` = 对应 run event id——两类 id 命名空间不重叠，天然唯一；
- run 派生 entry 无 `streamSeq` 语义，其 `streamSeq` 字段置为 trigger event 的 `streamSeq`，并以 `runSeq` 作为窗口内次级排序键（§10.4）。

### 10.4 全序与确定性

```text
entry 排序键 = (streamSeq, sourceRank, runId?, runSeq?)
  sourceRank: conversation = 0, run-derived = 1
```

同一 trigger 事件触发的 run 的全部输出排在 trigger 之后、下一个更高 streamSeq 的 conversation event 之前。确定性条件：

1. 事件页与 run 集在编译输入下固定；
2. 只含终态 run；
3. conversation lock 纪律保证：编译时刻除当前 run 外全部先前 run 已终态，而当前 run 的事件不可能进入自己的编译（manifest 编译发生在 run_started 之后、任何模型调用之前）。

### 10.5 entry 文本规则与未来文本比较的边界

- canonical 中间轮 assistant entry 的 `text` = 该轮模型的文本输出（无文本输出的 tool-call 轮为空串）；tool entry 的 `text` = 工具结果文本；
- legacy 侧模型可见历史保持结构化 tool-call block（`agentToModelMessages` 消费 payload 重建）；`messages.ts` 的 `[tool:<name>]` 占位符只是 legacy `contentText` 投影列（检索/预览用途），不是模型可见形态，禁止作为比较基准；
- Phase 4 的 diff 仍**只比较 user text**（与 Phase 3 相同）；assistant/tool 文本比较留待后续阶段，且前置条件是先定义两侧的归一化规则（如 tool-call 轮的 text 形态、错误结果的 isError 标记形态），否则会制造大量假 `unclassified_difference`。

### 10.6 v2 下的 outbound 事实

- `outbound_message_delivered` 不再产生 assistant entry（渠道转换文本不是模型可见历史；模型应看到自己的原始输出，与 legacy history 行为一致）；
- 它仍是必须记录的 conversation fact，用于对账与投递审计；
- v1 → v2 的这个语义差异由 policy 显式表达，不允许隐式切换。

### 10.7 memory input

`buildCanonicalMemoryExtractionInput` 在 v2 下过滤 `role ∈ {user, assistant}`（工具结果不进入记忆抽取输入）。该函数属 L3 纯函数，行为随 policy 参数化，v1 输出不变。

## 11. Agent 模块边界

```text
packages/agent/src/context-compiler/          # L3
  run-facts.ts          # run-facts reducer（纯）
  manifest.ts           # manifest / canonical request 文档构建（纯，输入为已解析事实与 revision id）
  （types/compiler/memory-input 扩展）

packages/agent/src/engine/run-ledger/         # L5
  recorder.ts           # per-run 串行队列、写点、fail-open、确定性 id
  revisions.ts          # revision/请求/响应/工具制品的 put 编排
  ids.ts                # runId/deliveryId/eventId/callId/manifestId 派生

packages/agent/src/engine/context-shadow/     # L5（Phase 3 既有）
  observer.ts           # 升级为 policy v2 编译输入
```

- recorder 通过 `AgentRunStore`、`ArtifactRevisionStore` 两个既有 Port 与新 Port `ArtifactContentSink` 写库，不依赖 server；
- layer check：`engine` 向下导入 `context-compiler`（L3）与 `ports`（L1）均为既有允许方向，无需新 exemption；`context-compiler` 新文件继续只导入 ports/shared；
- Server 新增：

```text
packages/server/src/db/run-ledger-rollout-store.ts     # rollout 表读取
packages/server/src/db/artifact-content-sink.ts        # 超限制品字节落资产存储（fact-ledger/ 前缀）
packages/server/src/db/agent-run-store.impl.ts         # +listRunEventsByStream
```

### 11.1 Port 扩展

```ts
// agent-run-store.ts 追加
export interface ListRunEventsByStreamInput {
  accountId: string;
  conversationStreamId: string;
  limit: number;
  /** Keyset cursor：上一页最后一条的 (recordedAt, eventId)。 */
  after?: { recordedAt: string; eventId: string };
}
listRunEventsByStream(input: ListRunEventsByStreamInput): Promise<AgentRunEvent[]>;
```

设计取舍：

- 用**单个按 stream 的聚合分页查询**，而不是 `listRunStarts` + 逐 run `listRun(runId)` 的 N+1——编译窗口等于当前 session（boundary 之后），run 数随会话线性增长，N+1 会让每次 shadow 编译的查询数随之膨胀；
- 排序为 `(recorded_at, event_id)` keyset 分页，过滤与前缀排序命中既有 `idx_agent_run_events_conversation` 索引；`event_id` 决胜不需要进索引——同一毫秒落库的行才需要内存排序，量级可忽略；
- reducer 拿到全部事件后按 `runId` 分组、组内按 `runSeq` 排序，terminal 判定与窗口过滤都在 reducer 内完成——分页与分组策略不影响确定性（§10.4 的排序键只依赖事件内容）；

```ts
// 新 Port
export interface ArtifactContentSink {
  put(key: string, content: Uint8Array): Promise<{ provider: string; key: string }>;
  /** 读回 put 写入的字节；v2 compiler 需要读回 entry 来源的大制品文本。 */
  get(key: string): Promise<Uint8Array | null>;
}
```

`get` 是评审后补的最小读取路径：超过 inline 上限的 `MODEL_RESPONSE`/`TOOL_RESULT` 若不可读回，v2 编译会把大回复/大工具结果降级为空 entry，直接破坏 shadow 收敛目标。完整重放/审计读取 API 仍不属于 Phase 4。

## 12. Shadow 对比扩展

- Phase 4 起 shadow observer 使用 policy v2 编译（run facts 开启），legacy normalizer 与固定类别不变；
- **差值语义补全**：Phase 3 已把 `legacy_only_assistant_entry` 修正为 `max(0, legacy.assistantEntryCount - canonicalAssistantEntryCount)`；v2 引入 canonical tool entries 后，`legacy_only_tool_entry` 同步改为 `max(0, legacy.toolEntryCount - canonicalToolEntryCount)`——否则该类别恒为 legacy 总数，v2 的收敛无法被度量；
- 预期变化：
  - `legacy_only_assistant_entry` 显著下降（canonical 已含 assistant entries），剩余部分来自未接线的主动推送等来源，仍属已解释差异；
  - `legacy_only_tool_entry` 下降到零附近（canonical 已含 tool entries）；
  - `entry_order_difference` 可能出现新形态（run entry 插入历史中部），若持续增长需要解释，而非新增类别；
- 文本比较边界见 §10.5：Phase 4 仍只比较 user text；
- v1 shadow（Phase 3 行为）保留为对照组继续运行同一 observer 吗？——不。同一 observer 只跑 v2；v1/v2 对比通过历史 result 表按 PK 区间回顾即可，避免双倍编译开销；
- `canonical_unresolved_attachment` 继续存在，直到 Phase 5 artifact 映射。

## 13. Observability

新增低基数指标：

```text
run_ledger_total{result=success|degraded|disabled}
run_ledger_event_total{event_type=<固定事件类型>}
run_ledger_inline_latency_ms            # run_started+manifest+context_compiled+delivery_requested 四次 inline 写耗时
artifact_put_total{kind=<固定种类>,result=appended|reused|failed}
context_manifest_total{result=success|failed|disabled}
```

允许日志字段：accountId、sourceEventId、runId、manifestId、deliveryId、round、errorCode、计数。禁止：正文、prompt、tool 结果、异常原始 message、CDN/AES、本地路径。

## 14. 数据库变更

新增 migration `20260829200000_add_run_ledger_phase_4`：

1. 创建 `run_ledger_rollouts`（`account_id` PK/FK、`enabled` default false、`updated_at`），默认关闭；
2. 其余为零：run/artifact 表 Phase 1 已建，payload 契约扩展存于 JSONB，无 DDL；`listRunEventsByStream` 的过滤与主排序依赖既有 `idx_agent_run_events_conversation`（`recorded_at` 收尾），`event_id` 决胜排序只作用于同毫秒尾部，不新增索引。

对账扩展（`fact-ledger-reconciliation.ts`）：

- zombie run：`run_started` 后超过阈值（默认 10 分钟）仍**无任何终态事件** → observation `zombie_run`。`ledger_degraded` 终态（§5.5）的 run 不算 zombie——fail-open 降级是合法形态，由 `run_ledger_total{result=degraded}` 计数，避免把正常降级误报为异常；
- 存在 `outbound_message_delivered` 但 causation source event 对应 run 非终态或缺失 → `unexpected`；
- run 缺少 `delivery_requested` 但存在 `delivery_succeeded`：**不标 `unexpected`**——这是 §6.3 定义的合法 degraded 形态，可通过 run 终态 `reason=ledger_degraded` 辨识；若未来 degraded 率收敛到零，此项再升级为不变量；
- `context_compiled` 引用的 manifestId 无对应 CONTEXT_MANIFEST 制品 → `unexpected`。

Phase 4 的对账是只读观测，不提供 repair 命令（run 事件不可重放执行，zombie run 仅记录）。

## 15. 错误处理

### 15.1 Ledger fail-open

- 全部 ledger 写入（inline 与 queued）失败均降级，不影响模型调用、回复、settle、sync cursor；
- inline 写（`run_started`、manifest put、`context_compiled`、`delivery_requested`）任一失败 → 本 run 整体不记录（不产生"没有 manifest 的 model_call_started"这类残缺链路），`run_ledger_total{result=degraded}` + 日志；`delivery_requested` 失败不影响已完成的 run 链，仅投递事实缺失；
- queued 写失败 → 该 run 降级，队列丢弃；已写入事件保留。

### 15.2 Manifest 完整性

- manifest put 成功但 `context_compiled` 失败：制品存在而 run 链断裂 → 对账 `unexpected`；下次同 receipt 不会重放（claim 语义），不自动清理；
- 制品 put 的 id-conflict（同 id 不同内容）视为 ledger 内部 bug，降级 + `artifact_put_total{result=failed}`。

### 15.3 Settle 侧

- delivery 事件 append 失败不改变 receipt 终态（settle 已完成的业务语义不变），记录指标；下一次同 receipt 不会重放，事件缺失由对账暴露；
- `outbound_message_delivered` append 失败同理；conversation fact 的缺失比 run event 缺失更严重（影响未来编译），对账规则优先覆盖。

## 16. 安全与隐私

- 制品内容不 sanitize（账本完整性优先），日志继续 sanitize；制品行不进入任何对外 API；
- run event `error` 字段只允许稳定 code；
- `textSent` 是发给用户的真实文本，进入 conversation fact 与 legacy `messages` 同等访问控制；
- rollout 表默认关闭；开启即意味着同意把上述制品写入事实账本；
- 允许日志字段白名单与 Phase 3 一致，新增 runId/manifestId/deliveryId。

## 17. 测试设计

### 17.1 Agent 纯单元测试（run-facts / manifest / ids）

- runId、deliveryId、callId、eventId、manifestId 的确定性与 NUL 拼接；
- run-facts reducer：`run_completed` run 纳入、interrupted 与 zombie run 排除、窗口过滤、排序键、artifact 缺失降级 diagnostic；
- v1 policy 输出与 Phase 3 快照逐字节一致（回归锚）；
- v2：assistant/tool entry 派生、outbound 不再成 entry、memory input 过滤 tool role；
- manifest 文档构建：conversationEventIds 完整性、runEventIds 只含先前 run、canonicalRequestHash 与 CANONICAL_REQUEST 文档一致；
- 确定性：同输入两次构建 deepEqual + hash 相同。

### 17.2 Recorder 单元测试

- inline 写顺序与 join 语义（manifest 先于 round-1 started）；
- **同源硬规则**：`manifest.canonicalRequestHash` 与 runner 实际 round-1 请求文档 hash 逐字节一致（§9.3 固定用例）；
- 队列串行性：并发入队事件的 append 调用顺序与逻辑顺序一致；
- 失败降级：任一 append 抛错后后续事件丢弃、指标与 onError 触发、生产回调不受影响；**降级时 best-effort 补写 `run_interrupted{reason:"ledger_degraded"}`**，标记本身失败时维持 zombie 形态；
- eventId 幂等：Store 返回 `appended:false` 时不重复入队。

### 17.3 SDK / lifecycle 测试

- `ProcessMessageOutcome` 对象形态的构造与回退兼容（无 ingress lifecycle 时行为不变）；
- 投递报告：文本+媒体部分失败 → `ok:false`；全成功 → 最后 clientId；
- settle 携带 deliveryReport 的传递链路（monitor → lifecycle）。

### 17.4 Server 单元测试

- `listRunEventsByStream` 查询形状、keyset 分页稳定性与 account 隔离；
- settle handler：正常路径写 delivery 事件与 outbound 事实；**`delivery_requested` 缺失（degraded run）时跳过 delivery run events 但照写 outbound fact**；失败路径只写 `delivery_failed`；
- rollout disabled 时 runtime 不构造 recorder、settle 跳过 delivery 分支；
- artifact sink：inline 未超限不走 sink、超限走 sink、sink 失败降级。

### 17.5 Disposable PostgreSQL 集成测试

- fresh deploy Phase 0–4 migrations；
- 完整 chat run 事件链断言：`run_started → context_compiled → model_call_* → tool_call_* → run_completed → delivery_requested → delivery_succeeded` 的 runSeq 严格递增且 causation 链正确；
- manifest 制品存在、`conversationEventIds` 覆盖窗口、`canonicalRequestHash` 与制品文档哈希一致；
- v2 编译（经真实 Store）：metadata-only variation hash 不变、run facts 进入 entries、boundary 前的 run 不进入；
- 同 receipt 重投 → 无第二 run；
- **degraded 形态**：注入 artifact put 失败后，run 链以 `run_interrupted{reason:"ledger_degraded"}` 终态、不进 canonical entries、对账不报 zombie；settle 对该 run 只写 outbound conversation fact；
- 制品去重：同内容 revision 二次 put `appended:false`；
- append-only 语义：Phase 1 trigger 已覆盖 `agent_run_events` 与 `artifact_revisions`，断言 UPDATE/DELETE 被拒绝；
- zombie run 对账 observation；
- rollout 缺失默认关闭。

### 17.6 回归

Phase 0–3 全部测试与 typecheck、layer check、`prisma validate/migrate:deploy/status`、Agent/Server/SDK 全量继续通过；特别地，Phase 3 shadow 测试在 v1 快照锚点上不得变化。

## 18. 文件级实施顺序

1. 契约扩展（model_call_started 可选 `requestArtifactId`）+ ids.ts 纯函数 + 单测；
2. Port 扩展（`listRunEventsByStream`、`ArtifactContentSink`）+ Server 实现 + 单测；
3. L3 run-facts reducer + v1 回归锚测试（先证明"未启用时零差异"）；
4. L3 manifest 文档构建 + 确定性测试；
5. L5 revisions.ts（revision 制品 put 编排）+ 单测；
6. L5 recorder + runner/turn 写点接入 + recorder 单测；此步完成前不得开启 rollout；
7. SDK 投递报告 + settle 扩展 + server delivery facts + 单测；
8. shadow observer 切 policy v2 + diff 预期更新；
9. migration（rollout 表 + 索引）、reconciliation 扩展、指标、disposable PostgreSQL 全链路测试。

每步保持 typecheck、layer check 与 Phase 0–3 回归通过。第 6 步未完成前不发布 rollout 表；第 9 步前不观察任何生产指标。

## 19. Rollout

1. fresh disposable PostgreSQL 执行全部 migration 与集成测试；
2. 部署 expand-only Phase 4 migration（rollout 表默认关闭）；
3. 部署 recorder/manifest/delivery 代码，rollout 关闭时为纯死代码路径；
4. 验证 `/clear` 与 Phase 2/3 链路不受影响；
5. 内部账号开启 `run_ledger_rollouts`；
6. 观察：`run_ledger_total` degraded 率、`run_ledger_inline_latency_ms`、zombie run、artifact put 失败、v2 shadow 的 `unclassified_difference` 与 `entry_order_difference`；
7. 扩展到更多账号；
8. Phase 4 保持生产读取不变。

停止条件：

- inline 写使 chat 首轮延迟 p95 增加超过 100ms；
- degraded 率持续 > 1%；
- zombie run 或 delivery 缺失对账持续增长；
- 制品表出现非哈希 id 或内容哈希校验失败；
- v2 shadow 的 unclassified_difference 不可解释地增长。

回滚：关闭 `run_ledger_rollouts` 并 restart 账号。已写入的 run event、制品、manifest、outbound 事实全部保留（它们是已发生的事实），不做删除。

## 20. 验收标准

1. 启用 rollout 的 ingress chat 产生完整、有序、因果闭合的 run event 链，且重投幂等；
2. manifest 存在性先于第一次模型调用，内容可独立重建 round-1 请求文档哈希；
3. prompt/skill/tool/model revision 以内容寻址制品固定，同内容去重；
4. v2 canonical context 的 assistant/tool entries 全部来自 Run Events，metadata-only variation 与 Phase 3 等价性质保持；
5. outbound 投递事实与渠道真实发送一致（含转换后文本），失败路径只记 delivery_failed；
6. ledger 任意失败不影响生产 chat、settle 与 cursor；
7. v1 policy 编译输出与 Phase 3 快照逐字节一致；
8. 对账新增三类观测可运行；
9. 生产读取仍来自旧 Message/Tape；
10. Phase 0–3 全部回归通过。

## 21. 预计文件范围

### Agent

```text
M packages/agent/src/shared/fact-ledger/contracts.ts        # model_call_started + requestArtifactId?
A packages/agent/src/context-compiler/run-facts.ts
A packages/agent/src/context-compiler/manifest.ts
M packages/agent/src/context-compiler/types.ts              # policy v2、entry 扩展、输入 v2
M packages/agent/src/context-compiler/compiler.ts
M packages/agent/src/context-compiler/memory-input.ts
M packages/agent/src/context-compiler/index.ts
M packages/agent/src/ports/agent-run-store.ts               # +listRunEventsByStream
A packages/agent/src/ports/artifact-content-sink.ts
M packages/agent/src/ports/index.ts
A packages/agent/src/engine/run-ledger/ids.ts
A packages/agent/src/engine/run-ledger/recorder.ts
A packages/agent/src/engine/run-ledger/revisions.ts
A packages/agent/src/engine/run-ledger/index.ts
M packages/agent/src/engine/runner.ts                       # 写点 hooks（recorder 可选注入）
M packages/agent/src/engine/turn.ts                         # runId、recorder 生命周期
M packages/agent/src/engine/context.ts                      # RunContext.runId?
M packages/agent/src/engine/context-shadow/observer.ts      # policy v2
M packages/agent/src/index.ts
A packages/agent/test/context-compiler/run-facts.test.ts
A packages/agent/test/context-compiler/manifest.test.ts
A packages/agent/test/engine-run-ledger/recorder.test.ts
A packages/agent/test/engine-run-ledger/ids.test.ts
M packages/agent/test/context-compiler/compiler.test.ts     # v1 回归锚 + v2 用例
M packages/agent/test/context-shadow/observer.test.ts
```

### Server

```text
M packages/server/src/db/agent-run-store.impl.ts
A packages/server/src/db/artifact-content-sink.ts
A packages/server/src/db/run-ledger-rollout-store.ts
A packages/server/src/db/run-ledger-rollout-store.test.ts
M packages/server/src/context-shadow-observer.ts            # compiler 注入 AgentRunStore
M packages/server/src/weixin/ingress-controller.ts          # settle delivery 分支
M packages/server/src/weixin/ingress-controller.test.ts
M packages/server/src/agent.ts                              # recorder 组装、deliveryId
M packages/server/src/runtime.ts                            # rollout 读取
M packages/server/src/db/fact-ledger-reconciliation.ts
M packages/server/src/db/fact-ledger-reconciliation.test.ts
M packages/server/prisma/schema.prisma
A packages/server/prisma/migrations/20260829200000_add_run_ledger_phase_4/migration.sql
M packages/server/test-integration/weixin-ingress-phase-2.test.ts
A packages/server/test-integration/run-ledger-phase-4.test.ts
```

### Weixin SDK

```text
M packages/weixin-agent-sdk/src/agent/interface.ts          # settle deliveryReport
M packages/weixin-agent-sdk/src/messaging/process-message.ts
M packages/weixin-agent-sdk/src/monitor/monitor.ts
M packages/weixin-agent-sdk/test/monitor-ingress-lifecycle.test.ts
M packages/weixin-agent-sdk/test/process-message.business.test.ts
```

### Observability

```text
M packages/observability/src/metrics/agent-metrics.ts
M packages/observability/src/metrics/index.ts
M packages/observability/src/index.ts
```

## 22. Phase 5 入口

Phase 5 在 Phase 4 的 run facts 边界上补齐剩余 coverage：

- Memory Event 正式写入与 Tape → Memory Event 迁移，`memoryEventWatermark` 与 `memoryArtifactId` 开始有真实值；
- Phase 2 attachment source ref → immutable MEDIA_ASSET 映射落地，`AttachmentArtifactResolver` 从 unresolved 默认实现切换为真实 resolver，vision observation 进入 `VISUAL_OBSERVATION` 制品；
- compaction summary 制品化（`SUMMARY`）与 `summaryArtifactIds` 填充；
- 主动推送与 scheduler/heartbeat 的 run/outbound 接线，收敛 `legacy_only_assistant_entry` 至零；
- 全部 coverage 开启且 shadow 收敛后，进入读取切换评估：Phase 4 的 manifest 与 run 链是切换的唯一依据，Phase 3 shadow result 与 v1 policy 结果不得用于切换证明。
