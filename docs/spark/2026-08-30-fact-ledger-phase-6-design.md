# Fact Ledger Phase 6：辅助 Run 源接线、收敛验证与生产读取切换

> 状态：已实现（Phase 0–5 回归 + disposable PostgreSQL 集成测试通过）
> 日期：2026-08-30
> 前置：Phase 5 coverage 补全（memoryFacts / immutableMediaArtifacts / SUMMARY）与 disposable PostgreSQL 集成测试已通过
> 范围：把 heartbeat / scheduler / 主动推送接入 Run Ledger，补齐 trigger-run 的 canonical 表达（policy v3），建立切换门禁报告与双跑对比期，最终按账号把 chat 上下文组装从旧 Message/Tape 切到 manifest 驱动的 canonical context；旧写路径全程保留
> 不含：messages 双写退役、Tape 退役、隐私删除策略（Phase 7）

## 1. 决策摘要

Phase 6 采用以下方案：

1. 辅助 run 源接线：heartbeat / scheduler 的 trigger turn 通过 `ChatExecutorPort` 路径进入 Run Ledger——trigger run 使用**一次性生成的 runId**（`run-v1:<uuid>`），无重投语义（tick 崩溃不重说）；`recorder.start()` 放宽为 `sourceEventId?`（trigger turn 无 ingress 出处，causationId 省略）；
2. 主动推送 outbound 事实：pulse `speak()` 在 push 成功后追加 `outbound_message_delivered`（`causationId = runId`、确定性 eventId `outbound-v1:<sha256(accountId+NUL+runId+NUL+"proactive")>`）与 `delivery_succeeded` run 事件；push 失败记 `delivery_failed` + `outbound_message_delivery_failed`；
3. **policy v3**：run-facts reducer 从 trigger run 的 round-1 CANONICAL_REQUEST 制品派生 `role: "trigger"` entry（prompt 文本），补齐"模型为什么开口"的历史——legacy history 里的 TRIGGER 消息由此获得 canonical 对应物；v2 编译行为不变；
4. **读取切换三态**：`run_ledger_rollouts` 增加 `read_path` 列（`legacy` / `dual` / `canonical`，默认 `legacy`）。`dual` 为对比期：同一 turn 同时走两条路径组装上下文，canonical 产物只算 hash + 计数指标、不喂给模型；`canonical` 才真正喂给模型；
5. 切换门禁：数据库不变量核查 + 收敛报告（`unclassified_difference = 0`、`legacy_only_*` 趋零、dual-run 差异计数趋零）+ Phase 5 覆盖率报告，全部满足才允许 `read_path = canonical`；
6. 失败语义反转方向：**canonical 读路径构建失败 → 当次 turn 回落 legacy 路径**（读路径 fail-open 回旧世界），与写侧 fail-open 互补；
7. 记忆注入在 Phase 6 继续来自 Tape recall（它就是运行时投影）；从 Memory Event 重放记忆投影属于 Phase 7 决策——本阶段 manifest 的 memoryArtifactId 只做审计锚点；
8. 不退役任何写路径：messages 双写、Tape 写入、legacy_message_projection_links 全部保留；Phase 7 才评估退役。

## 2. 目标

Phase 6 完成后，系统具备下面的并行链路：

```text
Trigger turn (heartbeat / scheduler)
  -> runId = run-v1:<uuid>（一次性生成）
  -> Phase 4 recorder 全链路（run_started → … → run_completed）
       + round-1 request artifact 内含 trigger prompt
  -> push 成功后：delivery_succeeded + outbound_message_delivered（causation = runId）

Chat turn (read_path = dual)
  -> legacy 组装（喂给模型，不变）
  -> canonical 组装（并行）→ AgentMessage[] hash + 差异计数 → 指标/日志

Chat turn (read_path = canonical)
  -> canonical 组装（喂给模型）
  -> 构建失败 → 当次回落 legacy + fallback 指标
```

必须满足：

1. `dual` 期对生产零影响：canonical 分支的任何失败只记指标，不影响模型调用与回复；
2. `canonical` 期构建失败自动回落 legacy 当次组装，记 `context_read_fallback_total`；
3. trigger run 的 memory 证据链如实降级：无 source event → 不写 memory_asserted（Tape 照常），不伪造；
4. policy v3 下 v2 的全部既有 hash 语义不变（trigger entry 仅存在于 v3 编译产物）；
5. 切换门禁报告可重复执行、可导出，全部通过才允许置 `canonical`；
6. 任何写侧 / 读侧行为对 `read_path = legacy`（默认）账号完全无变化。

## 3. 非目标

Phase 6 不做：

- `messages` 双写退役、`legacy_message_projection_links` 退役（Phase 7 评估）；
- Tape 退役或 Memory-Event 重放式记忆投影（Phase 7）；
- 隐私删除策略（独立设计）；
- 全量账号自动切换（只提供机制与报告，切换动作人工按账号执行）；
- Webhook / API chat 的 run ledger 接入（保持 Phase 4 范围）；
- canonical context 的持久化（正式 Context Manifest 制品在 Phase 4 已有；Phase 6 不新增逐 turn 持久化）；
- 修改 Phase 1–5 任何事实契约的既有字段语义。

## 4. 方案比较

### 4.1 方案 A：一次性全量切换读取路径

删除 legacy 分支，所有账号立即读 canonical。切换即回滚都需要发版，且无法在切换前获得"同一 turn 两条路径产物差异"的实测数据。

不采用。

### 4.2 方案 B：仅做门禁报告，不提供切换机制，切读另行开发

把 Phase 6 变成纯观测阶段，切换机制推迟。问题：切换涉及 buildUserMessage 的历史重建 + 记忆注入 + fallback，是 Phase 6 最需要沉淀和验证的代码；留到后面等于把最高风险的动作放在无对比数据的未来。

不采用。

### 4.3 方案 C：三态 read_path（dual 对比期 → canonical），legacy 永久保留为回退（采用）

对比期用生产流量实测两条路径的产物差异（hash 级），收敛后按账号切 `canonical`；canonical 构建失败当次回落 legacy。旧路径代码保留，`read_path = legacy` 账号零感知。

采用。

## 5. 辅助 run 源接线

### 5.1 trigger run 的身份与生命周期

- `runId` 对两种 trigger 源均为**确定性派生**（不使用 UUID）：
  - heartbeat：`run-v1:<sha256(accountId + NUL + "heartbeat" + NUL + pulseId + NUL + nextEvalAtISO)>`（tick 时刻的 due 水位）；
  - scheduler：`run-v1:<sha256(accountId + NUL + "scheduler" + NUL + taskId + NUL + fireAtISO)>`（本次触发的 fire 时间）。
  - 依据：heartbeat 是 at-most-once（tick 崩溃后退避，不重说）；scheduler 的 push 侧有 `findUnpushedRuns` → `deliverUnpushedRuns` 的 at-least-once 恢复，且 `executeTask` 先置 `running`——同一 (task, fireAt) 若被重执行，确定性 id 让全部事件幂等吸收，不产生第二条 run 链；
- `recorder.start()` 签名放宽：`sourceEventId?: string`——缺省时 `run_started.payload` 不含 `triggerEventId`，envelope `causationId` 省略、`correlationId = conversationStreamId`；
- `run_started` payload 增加可选 `anchorStreamSeq`（v1 契约加法，JSONB 无 DDL）：trigger turn 发起时从 ConversationEventStore 读取该执行流当前最后 `streamSeq` 写入，作为 trigger entries 在 conversation 流上的排序锚点（§7.2）——排序依据来自事实流本身，而非本地时钟；锚点读取走 store 新增的 `getStreamHeadSeq`（head 表水位，非分页扫描）；
- **空执行流合法**：scheduler 隔离会话首轮没有任何 conversation event，锚点缺省且 compile `eventCursor = 0`（空窗口）；validateInput 相应放宽为 `eventCursor >= 0`（ingress 恒 ≥1，行为不变）；
- **生产编译统一 v3**：run ledger 的 compile closure（ingress 与 trigger 两侧）在本阶段固定 `context-policy-v3`——trigger entry 由此进入 manifest 与读路径构建；policy v2 的编译器行为原样保留（回归锚与 shadow 口径，见 §7.1）；
- 写点与 Phase 4 完全一致（同一段 turn.ts 代码路径），只是调用方从 agent.ts 扩展到 `chat-executor.impl.ts`：server 端为 trigger turn 构造 recorder + compileContext closure（与 ingress 相同的 compiler 实例与 resolver）。executor 在返回 `runId` 前 `recorder.drain()`，保证引擎随后直写的 delivery 事实在全部 run 事件之后（全序稳定）。

### 5.2 主动推送 outbound 事实

`speak()` 在 `sendProactiveMessage` 成功后（经 PushService，`recordHistory: false` 语义不变）：

```text
delivery_succeeded（run 事件，streamId = trigger run 的执行流，
    causationId = deliveryId = delivery-v1:<sha256(accountId+NUL+runId)>）
outbound_message_delivered（conversation 事件：
    streamId = 用户真实目标会话，
    eventId = outbound-v1:<sha256(accountId+NUL+runId+NUL+"proactive")>,
    causationId = runId, correlationId = runId,
    text = push 的实际发送文本（markdown 转换由 push 侧完成，存实发文本）,
    attachmentRefs = []）
```

**两个 stream 必须区分**（评审确认项）：

- run 事件（含 delivery_*）属于 trigger run 的**执行流**——heartbeat 为 `pulse.conversationId`（执行流即目标），scheduler 为 `scheduler:{seq}` 隔离执行会话；
- outbound conversation fact 属于**用户真实目标会话**——heartbeat 为 `pulse.conversationId`，scheduler 为 `task.conversationId`（`targetConversationId`）。落错 stream 会污染 canonical 历史；
- conversation fact 的 `causationId` 与 `correlationId` 均为 runId，对账从 outbound fact 反查 trigger run 以 `correlationId` 关联（§12）。

push 失败 → `delivery_failed` + `outbound_message_delivery_failed`（`retryable: false`）。事件写入由 heartbeat / scheduler 引擎经 `ConversationEventStore` Port 直接写（L4 → L1 合法）；失败 fail-open，只记指标。

### 5.3 ChatExecutionResult 扩展

```ts
export interface ChatExecutionResult {
  text?: string;
  status: "completed" | "error";
  error?: string;
  /** Phase 6：trigger run 的 runId（run ledger 启用且未降级时存在）。 */
  runId?: string;
}
```

heartbeat / scheduler 引擎用 `result.runId` 关联推送事实；`runId` 缺失（rollout 关闭或降级）→ 跳过 outbound 事实写入，行为回落 Phase 5。

### 5.4 与 Phase 5 记忆证据链的交互

trigger turn 无 inbound 事件 → `memoryEvidence` 无 `sourceEventId` → `writeMemoryFactToLedger` 返回 `skipped_no_evidence`，只写 Tape。这是有意行为：**系统自言自语不作为记忆断言的证据源**（schema `min(1)` 约束保持，不放宽）。文档化，不修。

## 6. 切换门禁报告

新增 `ledger-gate-report`（server CLI，`pnpm -F @clawbot/server ledger:gate --account <id>`，输出 JSON）：

1. **不变量核查**（复用/扩展 `fact-ledger-reconciliation`）：
   - 无 `command_name='clear'` 且缺 causation boundary 的 receipt；
   - 无 zombie run（`run_started` 后超时无终态）；
   - 无"delivered outbound 缺 terminal run"的异常；
   - `memory_superseded_total{result=orphan_target}` 增速为零（进程内指标，报告窗口内）；
2. **收敛核查**（shadow result 表，按账号聚合）：
   - 近 N 天 `unclassified_difference = 0`；
   - `legacy_only_assistant_entry` / `legacy_only_tool_entry` / `canonical_unresolved_attachment` 趋零（排除历史存量口径：只统计 Phase 5 启用之后的 source events）；
   - `shadow_compile_failed` 无新增；
3. **dual-run 对比核查**：`context_dual_diff_total{result=different}` 近窗口为零，或差异全部落入已解释清单。**口径说明（实现确认）**：dual 产物不持久化（§9），进程内计数器无法被独立 CLI 读取——该项在 `ledger-gate-report` 中输出为 `mode: "manual"` 的核查项（提示操作者从运行中的部署确认近周期差异），门禁的机器可核查部分由 §6.1/§6.2/§6.4/§6.5 承担；
4. **覆盖核查**：该账号 Phase 5 启用后产生的消息，媒体映射覆盖 ≥ 99%（容忍历史图片加载失败）；memory assertion 写入失败率 < 1%；
5. **排序锚核查**：窗口内全部 trigger run 的 `run_started.payload.anchorStreamSeq` 均存在（§7.2——canonical 排序不得依赖本地时钟回退）。

`memory_superseded_total{result=orphan_target}` 已在 Phase 5 实现（fact-writer 防御分支 + result label），报告直接读取。任何一项不满足 → CLI 退出码非零并输出未达标项；满足 → 输出 `eligible_for_canonical: true`。切换动作（置 `read_path = canonical`）仍由人工执行。

## 7. Canonical 历史重建（读取切换的核心映射）

### 7.1 policy v3：trigger entry

- `contextPolicyRevisionId = "context-policy-v3"`：在 v2 之上，run-facts reducer 为 trigger run 派生 `role: "trigger"` entry——文本取该 run round-1 CANONICAL_REQUEST 制品中**最后一条 user/trigger 消息的完整组装文本**（含 `[当前时间: …]` / `<memory>` 注入，即 pulse/scheduler prompt 的最终形态）；
- **不剥离注入片段**：legacy TRIGGER 消息内容 = 同一 `assembleUserContext` 组装产物，双侧保留完整文本，dual 期 hash 对比才有意义；注入片段的差异属于组装器演进，由 dual 指标显形；
- 制品缺失 → 空 trigger entry + diagnostic `run_request_artifact_missing`（与 §10.2 既有降级一致）；
- 排序：trigger entry 位于该 run 全部派生 entry 之前（runSeq 最小者之前，模拟"先有 prompt 后有回复"）；
- v2 编译逐字节不变（v3 增量仅 trigger entry 与 §7.3 的 tool 配对增强）；`CanonicalConversationEntryV1.role` 联合扩展 `"trigger"`（加法）；
- **注意**：`contextPolicyRevisionId` 参与 canonical hash，v3 与 v2 的 hash 必然不同——"v2 hash 回归锚"指 policy v2 的编译输出逐字节不变（测试守护），生产 manifest 切 v3 后 hash 变化属预期。

### 7.2 run-facts reducer 的 trigger run 纳入规则（v3）

1. trigger run 无 `triggerEventId` → 排序锚点采用 `run_started.payload.anchorStreamSeq`（§5.1，发起时读取的事实流水位）：trigger entries 的 `streamSeq` 取 `anchorStreamSeq`，同一锚点内按 `runSeq` 排序——排序依据来自事实流本身，消除本地时钟/平台时钟偏差；
2. `anchorStreamSeq` 缺失（历史 trigger run / 读取失败）→ 回退 `run_started.occurredAt`（本地时钟）近似落位并记 diagnostic `run_anchor_missing`；**该回退只允许存在于 dual 期**——`read_path = canonical` 的门禁要求窗口内全部 trigger run 均含 `anchorStreamSeq`（§6 第 5 项）；
3. 终态规则不变（仅 `run_completed`）；`sourceRunId` 引用链不变。

### 7.3 Legacy → Canonical 映射表（读取切换的重建依据）

| legacy history 元素 | canonical 来源 | 备注 |
|---|---|---|
| user 文本消息 | conversation reducer entry（inbound text） | 值等价 |
| 用户图片 | 按**当前 chat 模型的视觉能力**决定：supportsImageInput → MEDIA_ASSET 制品 + sink.get() → base64 ImageContent；否则占位符文本 | 由构建时传入的模型能力决定，与历史当时无关 |
| assistant 回复 | run-facts entry（MODEL_RESPONSE 文本） | 原始 markdown，与 legacy 一致 |
| assistant tool-call 中间轮 | run-facts entry（空文本 assistant） | 保持 tool-call 配对 |
| tool 结果（含错误） | run-facts entry（TOOL_RESULT 文本） | isError 在制品文档内 |
| trigger prompt（pulse/scheduler） | policy v3 trigger entry（§7.1） | 从 round-1 request 派生 |
| Tape `<memory>` 注入 | **不变**——继续 Tape recall（§1.7） | 非本 phase 切换项 |
| `[当前时间: …]` 注入 | 不变——assembleUserContext 运行时注入 | 非历史内容 |

映射完成后 `AgentMessage[]` 的构建规则：entry.role → MESSAGE_ROLE 映射（user→USER、assistant→ASSISTANT、tool→TOOL_RESULT、trigger→TRIGGER），text → TEXT block；resolved media → IMAGE block（仅 vision 模型）。**验收方式 = dual 期逐 turn hash 对比**（§8）。

**tool-call 配对重建（实现细化）**：v2 entries 不携带配对信息，v3 为 tool entries 增加可选字段 `callId`（toolCallId）、`toolName`、`toolArguments`（TOOL_ARGUMENTS 制品的序列化 JSON）、`toolError`（是否失败）。canonical 构建时，同一 run 内"空文本 assistant entry + 后续同 run tool entries"重展开为：ASSISTANT 消息（合成 `tool_call` blocks，arguments 从制品还原）+ 逐条 TOOL_RESULT 消息——provider 的 tool 历史保持有效配对。非 vision 或超限（§20.2）时媒体落占位符文本。trigger entry 的 meta 固定 `{ kind: "pulse" }`（scheduler prompt 以 user 角色落库，trigger entry 只会来自 heartbeat pulse）。

## 8. 读取切换机制

### 8.1 read_path 三态

`run_ledger_rollouts` 增加 `read_path TEXT NOT NULL DEFAULT 'legacy'`：

| 值 | 行为 |
|---|---|
| `legacy` | 完全 Phase 5 行为（默认，写侧照常） |
| `dual` | 模型喂 legacy 产物；canonical 组装并行执行 → hash + `context_dual_diff_total{result=same\|different\|failed}` 指标与差异日志（仅计数，不含正文） |
| `canonical` | 模型喂 canonical 产物；构建失败当次回落 legacy + `context_read_fallback_total` |

### 8.2 实现位置

`loadConversationContext` 拆为双实现：

```text
packages/agent/src/engine/context-build/
  legacy.ts        # 现 ensureLoaded + recall 原样
  canonical.ts     # compileContext(v3) → entries → AgentMessage[]（含 media 重放）
  dual.ts          # 并行执行 + hash 对比 + 指标
```

`ChatTurnInput` 增加 `contextReadPath?: "legacy" | "dual" | "canonical"`（server 依 rollout 决定）；canonical 实现需要 compiler 实例与媒体重放依赖 → 经现有 `runLedger` 输入扩展传入（`compileContext` 已有；`contentSink` 为新增可选字段）；**当前 chat 模型的视觉能力**（`chatModel.meta.supportsImageInput`）由 turn 层传入构建器——媒体重放按当前能力决定（§7.3），不由历史决定。

**canonical 覆写语义（实现确认）**：`read_path = canonical` 时，构建成功的 `AgentMessage[]` **原位覆盖** conversation cache 的活数组——append / persist / rollback 语义随之保持一致（回滚仍作用于同一数组与消息表）。覆盖前的 legacy 视图快照供 context shadow 观察对比。`dual` 不覆写（模型喂 legacy，仅旁路对比）。canonical 构建失败 → 不覆写，当次回落 legacy（§8.3）。

### 8.3 canonical 构建的失败语义

- compile 抛错 / entries 构建 / media 重放失败 → 当次 `runChatTurn` 回落 legacy 组装，`context_read_fallback_total.inc({reason})`，turn 继续；
- 回落只影响当次：不降级 run ledger 写入、不改变 rollout 状态；
- 每账号 fallback 率连续超阈值（默认 5%）→ runtime 日志告警（人工回拨 `read_path = legacy`）。

## 9. 双跑对比期

- `read_path = dual` 时每 turn：legacy 产物喂模型（生产行为不变）；canonical 并行构建，比对：
  - `AgentMessage[]` 逐条 role + text 的 canonical hash；
  - 差异计数按固定维度：`entry_count` / `role_order` / `text_mismatch` / `media_missing`；
- 差异日志只含维度计数与 entry 序号，不含正文（安全约束与 Phase 3 一致）；
- dual 期产物不进入任何持久化（纯内存比对后丢弃）；
- dual 期 canonical 构建失败 → `context_dual_diff_total{result=failed}`，不影响生产。

## 10. Shadow 与 dual 的关系

- Phase 3 起 shadow 对比的是"编译出的 canonical context vs legacy 请求摘要"（文本级、维度固定）；Phase 6 的 dual 对比的是"两套完整 AgentMessage[] 组装产物"（结构级 hash）——dual 是 shadow 的末端验证，覆盖 memory 注入、media 重放、trigger entry 等组装细节；
- 两者都在 `read_path = dual` 期运行：shadow 验证账本内容，dual 验证组装机制；
- 切换门禁同时要求两者收敛（§6）。

## 11. Observability

新增：

```text
context_read_path_total{account, path}        # 每 turn 读路径计数
context_dual_diff_total{result=same|different|failed, dimension=*}
context_read_fallback_total{reason=compile_failed|media_failed|build_failed}
proactive_outbound_total{result=appended|failed|skipped_no_run}
```

沿用：run_ledger_* / artifact_put_total / memory_event_total / memory_superseded_total。

日志白名单追加：readPath、diffDimension、entryCount；禁止项不变（正文、prompt、媒体路径）。

## 12. 数据库变更

新增 migration `20260830210000_add_read_switch_phase_6`：

1. `run_ledger_rollouts` 增加 `read_path TEXT NOT NULL DEFAULT 'legacy'`（CHECK `IN ('legacy','dual','canonical')`）；
2. 其余为零：trigger run 复用 run/artifact 表；outbound 事实复用 conversation_events；无新表。

对账扩展（proactive 事实，设计评审确认项）：

- `outbound_message_delivered` 的 `causationId = runId`（非 inbound receipt），经 `correlationId = runId` 反查 trigger run；
- 该 run 必须终态（`run_completed`），否则 unexpected；
- **streamId 校验按目标会话**：outbound fact 的 `streamId` 是用户真实目标会话，可与 run 的执行流（scheduler 隔离会话）不同——对账按 `correlationId` 关联后不比较 streamId 相等，只比较 run 存在且终态；
- 排序锚核查：窗口内 `run_started` 缺 `anchorStreamSeq` 的 trigger run 计数（canonical 切换门禁输入，§6.5）。

## 13. 错误处理

- **读路径 fail-open 回 legacy**：canonical 构建任何失败 → 当次回落 + 指标；不重试、不降级 run；
- trigger run 写入失败 → 该次 turn 的 ledger 链降级（Phase 4 语义），speak/push 照常；
- push 失败 → delivery_failed + outbound_message_delivery_failed，speak 返回 false（heartbeat 既有退避接管）；
- `read_path = canonical` 且 fallback 连续发生 → 仅告警，不自动回拨（人工回拨，避免读路径抖动）。

## 14. 安全与隐私

- dual 对比日志不含正文（维度计数 + hash）；
- canonical 读路径从 sink 读回媒体字节仅驻留当次请求内存，不落盘；
- `read_path` 变更经 rollout 表（人工），产生 `updated_at` 审计；
- legacy 路径保留期间，用户内容仍然双写——隐私删除策略（Phase 7）必须同时覆盖两套存储，本阶段不引入新的删除语义。

## 15. 测试设计

### 15.1 Agent 单元测试（业务需求驱动）

- trigger run 的 v3 编译：trigger entry 从 round-1 request 派生、位于回复之前、文本与 legacy TRIGGER 消息一致；
- trigger run 无 request 制品 → 空 trigger entry + diagnostic，不猜测；
- v2 hash 回归锚不变（v3 新增 entry 不影响 v2）；
- canonical 历史重建：user/assistant/tool/trigger 四类 role 的 AgentMessage 映射；媒体重放（vision）与占位符（非 vision）；
- canonical 构建失败 → fallback 结果 + 原因标记；
- dual 对比：相同输入 → same；角色顺序差异 → different + dimension 计数；构建失败 → failed。

### 15.2 Server 单元测试

- chat-executor 为 trigger turn 构造 recorder（rollout 关 → 不构造）；
- ChatExecutionResult.runId 透传；
- heartbeat push 成功 → delivery/outbound 事实；runId 缺失 → skipped_no_run；
- read_path 三态经 rollout 读取映射到 ChatTurnInput。

### 15.3 SDK / 心跳集成

- heartbeat speak 的 push 失败路径不产生 outbound delivered 事实。

### 15.4 Disposable PostgreSQL 集成测试

- fresh deploy Phase 0–6 migrations；
- trigger run 全链路：run_started（无 triggerEventId）→ … → run_completed → push 后 delivery_succeeded + outbound_message_delivered（causation = runId）；
- v3 编译：trigger entry + assistant/tool entries 的排序与文本；
- v2 与 v3 编译同输入下 v2 hash 与 Phase 4 快照一致；
- memory_events append-only 仍生效；
- read_path 默认 legacy；置 canonical 后对账扩展通过；
- 对账：proactive outbound（causation = runId）+ terminal run → 正常，无 unexpected。

### 15.5 回归

Phase 0–5 全部测试与 typecheck、layer check、prisma validate/migrate deploy；Phase 4/5 的 v2 hash 回归锚不变；`read_path = legacy`（默认）账号的行为与 Phase 5 逐字节一致。

## 16. 文件级实施顺序

1. `run_ledger_rollouts.read_path` migration + rollout store 扩展 + 单测；
2. recorder.start 放宽 `sourceEventId?` + trigger runId 生成 + 单测；
3. chat-executor.impl 接线（recorder + compileContext + ChatExecutionResult.runId）+ heartbeat/scheduler 引擎 outbound 事实 + 单测；
4. policy v3：run-facts reducer trigger entry（从 round-1 request 制品派生）+ v2 回归锚 + 单测；
5. context-build 三实现（legacy/canonical/dual）+ media 重放 + 单测；
6. turn.ts / server 接线（read_path → ChatTurnInput）+ 单测；
7. 门禁报告 CLI + 对账扩展 + 单测；
8. disposable PostgreSQL 全链路集成测试。

每步保持 Phase 0–5 回归通过。第 5 步完成前不得出现 `dual` 值；门禁报告（第 7 步）完成前不得出现 `canonical` 值。

## 17. Rollout

1. fresh disposable PostgreSQL 全部 migration + 集成测试；
2. 部署 Phase 6 代码（`read_path` 默认 legacy，全部为死代码路径）；
3. 内部账号先置 `dual`，观察 `context_dual_diff_total` 至少一个完整业务周期（含媒体消息、pulse 触发、/clear）；
4. 门禁报告通过 → 置 `canonical`（单账号）；
5. 观察 fallback 率、run ledger 指标、shadow 指标一个周期；
6. 按账号逐步扩展；任何账号可随时回拨 `legacy`（人工，立即生效于下一 turn）。

停止条件：

- canonical 期 fallback 率 > 5%；
- dual 期 diff 持续无法归零且无法解释；
- trigger run 链 degraded 率 > 1%；
- proactive outbound 事实缺失（对账 unexpected）；
- 任何 正文/hash 外的数据 出现在 dual 日志。

回滚：`read_path = legacy` 立即生效；已写入的 trigger run 事件、outbound 事实、SUMMARY/observation 制品全部保留（事实不删）。

## 18. 验收标准

1. heartbeat / scheduler turn 产生完整、幂等的 run 事件链；pulse 推送产生 outbound 事实且与 run 因果闭合；
2. v3 编译包含 trigger entry，v2 hash 回归锚不变；
3. dual 期对生产零影响且差异计数可解释；
4. 门禁报告四类核查可重复执行；
5. `read_path = canonical` 账号的模型上下文完全由 canonical 组装构建，构建失败自动回落 legacy；
6. `read_path = legacy` 账号行为与 Phase 5 逐字节一致；
7. 未发生任何写路径退役；
8. Phase 0–5 全部回归通过。

## 19. 预计文件范围（实现后核对）

### Agent

```text
M packages/agent/src/context-compiler/types.ts            # role +"trigger"、policy v3 常量、tool 配对字段、诊断码
M packages/agent/src/context-compiler/run-facts.ts        # trigger entry 派生 + 锚点排序 + extractRound1TriggerPrompt + tool 增强
M packages/agent/src/context-compiler/compiler.ts         # v3 分支（request/arguments 制品解析、锚点解析、cursor 0）
M packages/agent/src/ports/chat-executor.ts               # ChatExecutionResult.runId? + triggerIdentity
M packages/agent/src/ports/conversation-event-store.ts    # getStreamHeadSeq（锚点读取）
M packages/agent/src/engine/run-ledger/recorder.ts        # start 的 sourceEventId? 放宽 + trigger envelope 语义
M packages/agent/src/engine/run-ledger/ids.ts             # createTriggerRunId
M packages/agent/src/engine/turn.ts                       # readPath 分支 + ChatTurnInput 扩展 + canonical 覆写
A packages/agent/src/engine/context-build/legacy.ts
A packages/agent/src/engine/context-build/canonical.ts
A packages/agent/src/engine/context-build/dual.ts
A packages/agent/src/engine/context-build/index.ts
A packages/agent/src/capabilities/outbound-facts.ts       # recordProactiveOutbound（引擎直写，fail-open）
M packages/agent/src/capabilities/heartbeat/engine.ts     # triggerIdentity + push 后 outbound 事实
M packages/agent/src/capabilities/scheduler/executor.ts   # 同上（run stream ≠ 目标会话）
M packages/agent/src/index.ts                             # 导出
A packages/agent/test/context-compiler/trigger-entry.test.ts
A packages/agent/test/context-build/canonical.test.ts
A packages/agent/test/engine-run-ledger/trigger-run.test.ts
```

### Server

```text
M packages/server/src/db/chat-executor.impl.ts            # trigger run 接线（rollout 门控 + 锚点 + runId 透传 + drain）
A packages/server/src/db/fact-ledger-runtime.ts           # 共享 metrics adapter / content sink / v3 compiler 工厂（避免 ai↔agent 循环）
M packages/server/src/db/conversation-event-store.impl.ts # getStreamHeadSeq 实现
M packages/server/src/db/fact-ledger-reconciliation.ts    # proactive outbound 对账规则（runId 关联、不比 streamId）
M packages/server/src/agent.ts                            # readPath 注入 + compile closure 切 v3
M packages/server/src/runtime.ts                          # read_path 启动快照
M packages/server/prisma/schema.prisma
A packages/server/prisma/migrations/20260830210000_add_read_switch_phase_6/migration.sql
A packages/server/src/ledger-gate-report.ts               # 门禁报告 CLI（ledger:gate）
M packages/server/package.json                            # ledger:gate script
A packages/server/src/db/chat-executor.impl.test.ts
M packages/server/src/db/fact-ledger-reconciliation.test.ts  # proactive 关联用例
M packages/server/src/db/run-ledger-rollout-store.test.ts    # readPath 用例
A packages/server/test-integration/read-switch-phase-6.test.ts
```

### Observability

```text
M packages/observability/src/metrics/agent-metrics.ts     # §11 四个新指标
M packages/observability/src/metrics/index.ts
M packages/observability/src/index.ts
```

## 20. 风险与开放问题

1. **trigger entry 的文本保真**：legacy TRIGGER 消息内容 = `assembleUserContext` 组装后的 prompt（含时间注入）；canonical 从 round-1 request 取的 messages[0] 也是组装后文本——两者应一致，dual 期验证；若不一致，差异会在 dual 指标中显形，属预期发现而非回归。
2. **媒体重放的体积**：vision 会话历史含多图时，canonical 重建会逐个 sink.get；实行 per-turn 上限（如 8 张）并在超限时落占位符 + 指标。
3. **runStartedAt 排序键的时钟来源**：trigger run 无平台时间，`run_started.occurredAt` 为本地时钟——与 conversation 事件（平台时间）并存时的相对次序可能偏差数秒；dual 期验证对模型可见行为无影响后接受。
4. **`read_path = canonical` 期间的 memory evidence**：记忆注入仍来自 Tape，Memory Event 仅审计——如果出现 Tape 与 Memory Event 不一致（投影缺口），生产可见而账本滞后；Phase 7 的 memory projection 决策是根治项，Phase 6 靠对账暴露。

## 21. Phase 7 入口

Phase 6 完成且 canonical 读路径稳定运行一个观察周期后：

- **写路径退役评估**：`messages` 双写、legacy projection link、Tape 写入的流量归零方案与回滚窗口；
- **Memory projection**：从 Memory Event 重放替代 Tape recall（Tape 转纯投影/退役）；
- **隐私删除策略**：覆盖 conversation_events / artifacts / memory_events / sink 文件的删除或加密抹除设计（独立文档）；
- **历史重建的长期重放**：CANONICAL_REQUEST 制品的完整性审计与重放执行器。
