# Fact Ledger Phase 7：旧路径退役、历史边界与 Memory Projection

> 状态：已实现（Phase 0–7 全量回归通过 + 三个 CLI 一次性 PostgreSQL 冒烟通过；§19）
> 日期：2026-09-03
> 前置：Phase 6 读取切换机制（read_path 三态）已合入并提交（`5bc998c`）
> 范围：旧 `messages` 历史的边界导入与 `reconstructability=partial` 标注、prompt-shaped 写路径退役门控、Memory Event 重放投影与 Tape 的读路径解耦、run 制品完整性审计；全部机制 rollout 门控、默认关闭
> 不含：隐私删除策略（独立设计文档）、Web UI 切换到事实投影、Tape 物理退役与 purge 策略、真正的 manifest-pinned 逐点历史重放执行器

## 1. 决策摘要

Phase 7 采用以下方案：

1. **旧历史导入为事件，不做正则拆分**：新增 conversation 事件类型 `legacy_transcript_imported`（每会话流一条批量事件），把 ledger 启用前的 `messages` 行**按原样**导入为 opaque 条目——user 消息保留组装后文本（含当时的 Tape/时间注入），不做任何"拆回用户原文"的脆弱正则；payload 显式携带 `reconstructability: "partial"`；
2. **policy v4**：编译器新增 `context-policy-v4` = v3 + legacy entries。legacy 条目固定 `streamSeq = 0`（合成排序位：永远位于事实条目之前）、共享合成 `runId = legacy-import-v1:<sha256(accountId+NUL+streamId)>`、`runSeq = sourceMessageSeq`——v3 的 tool-call 配对重建因此对 legacy 条目同样生效；存在 session boundary（`/clear`）的窗口内 legacy 条目整体不出现；
3. **写路径退役三态**：`run_ledger_rollouts` 新增 `legacy_write_mode`（`prompt_shaped` 默认 | `clean` | `suspended`）。`clean` = messages 继续作为 Web UI 投影写入，但 user 消息持久化为**用户原文**（不含组装文本与 visualContext sidecar）；`suspended` = 完全停止写 messages 行。`clean` 仅在 `read_path = canonical` 时生效（接线层强制降级回 `prompt_shaped` + 告警），保证 legacy/dual 账号逐字节不变；
4. **Memory projection 读路径三态**：`run_ledger_rollouts` 新增 `memory_read_path`（`tape` 默认 | `dual` | `events`）。`events` = 从 memory events 重放记忆投影（base 取最新 anchor/import 快照事件，其后按 memorySeq 折叠 asserted/superseded/retracted/corrected）；`dual` = 双跑对比格式化记忆块 hash。读失败 fail-open 回 Tape；
5. **Tape 存量记忆导入**：新增 memory 事件类型 `memory_imported`（每 branch 一条），把当前 Tape 投影状态固化为 `MEMORY_SNAPSHOT` 制品 + 不可变导入事件，`reconstructability: "partial"`——与 conversation 侧 legacy 导入对称，补上 Phase 5 之前与 trigger run（无证据链不写账本）的记忆缺口；
6. **重放完整性审计**：新增 `ledger:replay-audit` CLI——对窗口内每个 `run_completed` run 核查 CANONICAL_REQUEST / MODEL_RESPONSE / manifest 制品存在性、制品 sha256 与 sink 可读性，输出覆盖率；门禁报告（`ledger:gate`）扩展 legacy 导入覆盖核查；
7. **不退役任何读取路径**：`restoreHistory`、Web UI messages 读取、Tape 写入全部保留。Phase 7 退役的是"prompt-shaped 写入"与"messages/Tape 作为模型上下文源"（后者 Phase 6 已完成），messages 正式降级为 Web UI 投影；
8. 隐私删除策略继续独立立项：本阶段新增的两类导入事件让"哪些历史是 partial"第一次成为可查询事实，是删除策略的输入而非实现。

## 2. 目标

Phase 7 完成后：

```text
旧会话（ledger 启用前有历史）
  -> ledger:legacy-import（一次性、幂等）
       -> legacy_transcript_imported 事件（reconstructability=partial）
  -> policy v4 编译：legacy entries 位于事实 entries 之前
  -> canonical / dual 上下文重见完整关系史（含不可重建的显式标注）

messages 写路径（legacy_write_mode = clean，且 read_path = canonical）
  -> user 消息持久化 = 用户原文 + image blocks（UI 投影）
  -> 组装文本、visualContext sidecar 不再进入 messages.payload
  -> messages 正式成为纯 UI 投影（模型上下文已由 Phase 6 切到 facts）

记忆（memory_read_path = events）
  -> memory_imported（Tape 存量快照，partial）+ memory_asserted/... 重放
  -> 注入不再依赖 Tape 表读取；Tape 降级为投影之一
```

必须满足：

1. 默认（`prompt_shaped` + `tape` + 不导入）下，全部账号行为与 Phase 6 逐字节一致；
2. legacy 导入幂等：重复执行产生同一 eventId，store 以 id-retry 语义吸收；
3. legacy 条目不改变 v2/v3 编译输出（policy 增量，hash 回归锚不动）；
4. `/clear`（session boundary）后的窗口不含 legacy 条目——清空语义优先于历史延续；
5. `clean` 写入模式下 Web UI 用户消息显示原文（验收标准 §20.1 的最后一块）；
6. `events` 记忆路径在 events 落后于 Tape（投影缺口）时如暴露差异，由 `dual` 指标显形，不静默。

## 3. 非目标

- 隐私删除 / 加密抹除（conversation_events / artifacts / memory_events / sink 文件）——独立文档；
- Web UI 从 facts 重建对话时间线（messages 投影继续服务 UI）；
- Tape 表停止写入或 purge 策略调整（`memory_read_path = events` 稳定后另行评估）；
- manifest-pinned 的逐点历史重放执行器（§10.4 历史重放）——`ledger:replay-audit` 只做完整性与覆盖率审计；真正的历史重放需要按原 manifest revision 固定编译，独立立项；
- 触发 run 的记忆断言证据链放宽（Phase 6 §5.4 的 `min(1)` 契约不变，缺口由 `memory_imported` 快照覆盖）；
- 老图片的字节级重放：legacy 条目的 attachmentRefs 只携带 asset id 引用，Phase 5 媒体映射表不覆盖旧资产 → canonical 构建按既有规则落占位符（partial 语义的一部分）。

## 4. 方案比较

### 4.1 旧历史：正则拆分恢复原文 vs opaque 整体导入（采用后者）

从组装文本里拆出"用户原文 vs Tape vs 时间"需要按 prompt profile 的格式正则逆向，格式演进即碎裂，且拆分结果不可验证。架构文档明确禁止。整体导入保留全部信息量、显式标注 partial、可随时被更好的重建策略替换（事件不可变，重导入需显式 tombstone + 新事件）。

采用 opaque 导入。

### 4.2 旧历史落点：conversation 事件 vs 独立 legacy projection 表

独立表让编译器多一个非事件输入源，manifest 的 `conversationEventIds` 无法引用 legacy 内容，审计链断裂；事件方案复用 stream seq 分配、append-only 约束、编译器读取管线与 manifest 引用。

采用事件。

### 4.3 导入粒度：每消息一条事件 vs 每流一条批量事件

每消息一条会让 streamSeq 空间被历史内容占据数百位、与真实事件的时间顺序在 seq 上完全倒置（seq 只能追加）；批量事件一条占用一个 seq，内部顺序由 `sourceMessageSeq` 表达，幂等面收敛为单个 eventId。

采用批量事件。

### 4.4 messages 写退役：直接停写 vs clean 投影（采用后者）+ suspended 逃生门

直接停写会冻结 Web UI（其读取仍来自 messages）。clean 模式让 messages 立即满足"UI 用户消息只显示用户原文"，同时保留 UI 兼容；suspended 提供机制上的终态（供未来 UI 切换后使用），默认不启用。

采用 clean 为主、suspended 为逃生门。

### 4.5 记忆缺口：放宽 trigger run 证据链 vs Tape 快照导入事件

放宽证据链违反 Phase 6 明确保留的契约（系统自言自语不作为记忆证据），且无法覆盖 Phase 5 之前的存量。快照导入与 conversation 侧方案对称：存量状态整体成为显式 partial 基线，之后的事件在其上折叠。

采用 `memory_imported`。

## 5. Legacy 历史导入

### 5.1 事件契约（additive）

`CONVERSATION_EVENT_TYPE.LEGACY_TRANSCRIPT_IMPORTED = "legacy_transcript_imported"`：

```ts
payload = {
  source: "messages_projection",
  reconstructability: "partial",
  /** 本批覆盖的 messages.seq 上界（含）；导入范围 = seq ≤ boundaryMessageSeq。 */
  boundaryMessageSeq: number,
  /** 被省略的更早消息条数（超过单批容量时省略最旧的，显式记录）。 */
  omittedEntryCount: number,
  entries: Array<{
    sourceMessageSeq: number,           // 原 messages.seq，批内排序键
    role: "user" | "assistant" | "trigger" | "tool",
    occurredAt: string,                 // 原消息 createdAt
    text: string,                       // 组装后文本原样（assistant/tool 为内容文本）
    attachmentRefs?: string[],          // payload image block 的 assetId（可解析性不保证）
    callId?: string,                    // tool 条目：原 toolCallId
    toolName?: string,
    toolArguments?: string,             // 序列化 arguments JSON（取自配对 assistant 的 toolCall block）
    toolError?: boolean,
  }>,
}
```

- `eventId = legacy-import-v1:<sha256(accountId + NUL + streamId)>`——每流至多一条，重复执行幂等（同 id 同 payload → appended:false；Tape/messages 变化导致 payload 不同 → `FactLedgerIdConflictError`，CLI 显式报出，需人工 `--force` 前置确认后用 tombstone 流程，v1 直接拒绝）；
- envelope：`actor = { kind: "system" }`（system 行为允许省略 id）、`occurredAt = receivedAt = recordedAt = now`（导入时刻，不是消息时间——消息时间在 entries 内）、无 causation/correlation；
- 契约校验：entries 数组元素 strict schema；单条 text 长度上限 64KB；单流默认上限 500 条（`--max-entries` 可调，上限 2000）——超出省略**最旧的**并记入 `omittedEntryCount`（partial 的显式部分，控制每次编译的体积）。

### 5.2 导入边界与范围（CLI `ledger:legacy-import`）

`pnpm -F @clawbot/server ledger:legacy-import --account <id> [--conversation <id>] [--max-entries N] [--dry-run]`，输出 JSON 报告：

1. 对账号下每个出现过的 `(accountId, conversationId)`：
   - 读 `legacy_message_projection_links`（state='persisted'）的最小 `messageSeq` 记为 B；
   - **有 link**：legacy 范围 = `messages.seq < B` 的行（link 之后的行由真实事件覆盖）；
   - **无 link 且该流零 conversation events**：全部 messages 行都是 legacy（从未被 ledger 覆盖的会话，如纯 webhook/API 会话）；
   - **无 link 但流上已有事件**：边界不可判定 → `refused_no_boundary`，不猜；
   - **流上存在 session boundary**：`skipped_cleared`（清空后的窗口按语义不含 legacy；reducer 侧同时防御性丢弃，双保险）；
   - **无 legacy 行 / 已导入**：`skipped_empty` / `skipped_imported`（读头事件探测既有 eventId）；
2. 条目构建（按 seq 升序遍历 messages 行，逐 payload 解析）：
   - `user` → text = text blocks 连接；attachmentRefs = image blocks 的 assetId；丢弃 placeholder 文本与 promptReplacementText（它们是能力降级策略产物，不是历史内容）；
   - `assistant` → text = text blocks 连接（不含 toolCall marker）；其 toolCall blocks 记入 `callId → (name, arguments)` 映射；
   - `toolResult` → role `tool`，callId/toolName 取自身字段，toolArguments 从映射回查（缺失 → 省略字段），text = text blocks 连接，toolError = isError；
   - `trigger` → role `trigger`，text 原样（prompt 全文）；
   - 空文本条目跳过（error 占位消息不导入）；
3. 组装 payload → `parseAppendConversationEventInput` 校验 → `ConversationEventStore.append`；
4. 指标 `legacy_import_total{result=appended|skipped_*|refused_*|failed}`。

导入时机约束：流上已存在事件时，批量事件的 streamSeq 在这些事件之后；**当次编译窗口（cursor = 已有事件 seq）不含批量事件**，下一个 ingress turn 起才生效——文档化为"导入后首个 turn 起可见"，不做重排。

### 5.3 policy v4：legacy entries 编译规则

`CONTEXT_POLICY_REVISION_ID_V4 = "context-policy-v4"`（v3 语义全量保留）：

- `reduceConversationEvents` 识别 `legacy_transcript_imported`：每个 entry 产出 canonical entry：
  - `eventId = "legacy-entry-v1:<sha256(eventId + NUL + sourceMessageSeq)>"`（合成，可稳定引用）；
  - `streamSeq = 0`（文档化的合成排序位：先于一切事实条目；0 不与真实事件冲突——`streamSeq` 从 1 分配）；
  - `runId = legacy-import-v1:<sha256(accountId + NUL + streamId)>`（与批量事件 eventId 相同的合成 runId）、`runSeq = sourceMessageSeq`；
  - role 按导入 role 直取（`tool` 条目带 callId/toolName/toolArguments/toolError）；
  - `reconstructability: "partial"`、`sourceMessageSeq` 透传（entry 新增两个可选字段，additive）；
  - **窗口内存在 session boundary → legacy 条目整体丢弃**（boundary 语义优先）；
- `compareCanonicalEntries` 无需修改：seq 0 最小；同 seq 下 runId 排序确定批内次序（runSeq 即 sourceMessageSeq）；
- v1/v2/v3 编译路径不识别该事件类型时……不成立：reducer 是共享代码，识别逻辑必须对 policy 无感——**reducer 始终产出 legacy 条目，但仅当 policy ≥ v4 时合入**（v2/v3 的输出集合过滤掉 `reconstructability` 条目），保证 v2/v3 hash 回归锚逐字节不变；
- 附件解析：legacy 条目的 attachmentRefs 进入既有 resolver 管线；Phase 5 映射表无记录 → `artifact_mapping_missing`（既有 unresolved 语义）→ canonical 构建落占位符。

### 5.4 读取侧（context-build/canonical.ts）

无需结构性修改：legacy assistant 条目 + 同合成 runId 的后续 tool 条目命中既有 v3 tool 配对重建分支；`trigger` role 条目沿用既有映射；`buildUserEntryMessage` 对带 attachmentRefs 的 legacy 条目按当前模型能力决定占位符/重放（旧资产必然 unresolved → 占位符）。

## 6. messages 写路径退役

### 6.1 三态语义

| `legacy_write_mode` | user 消息持久化 | assistant/tool/trigger 持久化 | 适用 |
|---|---|---|---|
| `prompt_shaped`（默认） | 现状（组装文本 + visualContext sidecar） | 现状 | 全部存量账号、legacy/dual 读路径 |
| `clean` | **用户原文** text block + image blocks（assetId 保留、promptReplacementText 剥离）；visualContext sidecar 不落 payload | 不变 | `read_path = canonical` 账号 |
| `suspended` | 不写 | 不写 | UI 切换 facts 投影后的终态（本阶段仅提供机制） |

内存中的 history 数组（模型上下文组装用）不受写模式影响——`clean` 只改**持久化投影**的形状；legacy 读路径依赖内存组装文本，故 `clean` 强制绑定 canonical。

### 6.2 门控实现

- agent 新增 port 风格解析器 `packages/agent/src/ports/projection-write.ts`：`setProjectionWriteModeResolver(resolver: (accountId: string) => ProjectionWriteMode)`，缺省恒返 `prompt_shaped`（全部既有测试零改动）；
- 写点收口（三处，全部经 `getMessageStore().queuePersistMessage`）：
  - `turn.ts appendMessage`：mode=clean 且 role=user → 持久化投影变体（原文 text + image blocks）；mode=suspended → 跳过；
  - `turn.ts createMessageTracker`：assistant/tool 消息，mode=suspended → 跳过（clean 不改变其形状）；
  - `cache.appendAssistantText`（主动推送）：mode=suspended → 只入内存不持久化；
- 每次决策计 `projection_write_total{mode}` / `projection_write_skipped_total{reason=suspended}`；
- 投影变体的 `content_text` = 用户原文（UI 列表与搜索直接受益）；`seq`、link 写入逻辑不变（link 仍指向该行，对账不受影响）。

### 6.3 生效条件（server 接线）

`runtime.ts` 启动快照增加 `legacyWriteMode`；`legacyWriteMode !== "prompt_shaped" && contextReadPath !== "canonical"` → 降级 `prompt_shaped` 并 `runtimeLogger.warn`（写模式与读路径的绑定的强制点，不做成 DB CHECK——两列组合的约束在代码层表达更可观测）。trigger turn（chat-executor）同样透传。

## 7. Memory Projection

### 7.1 `memory_imported` 事件契约（additive）

`MEMORY_EVENT_TYPE.MEMORY_IMPORTED = "memory_imported"`：

```ts
payload = {
  source: "tape_projection",
  reconstructability: "partial",
  snapshotArtifactId: string,   // MEMORY_SNAPSHOT 制品（serializeState 后的 TapeState 全量）
  throughMemorySeq: number,     // 导入时该 branch 的事件水位
}
```

- `eventId = memory-import-v1:<sha256(accountId + NUL + branch + NUL + snapshotSha256)>`（内容寻址：Tape 后续变化 → 新导入事件，append-only 自然表达"多次导入"，fold 取最新）；
- **幂等靠 `getById` 预探测，不靠 store 的 id-retry**：payload 含 `throughMemorySeq`（branch 事件水位），每次导入都会前进，因此"同 eventId + 不同 payload"——id-retry 会判为 `FactLedgerIdConflictError` 而非幂等命中。实现在写入前按 eventId 探测：已存在 → `skipped_imported`；Tape 变化 → snapshotSha 变化 → 新 eventId → 正常追加。（验收时发现并重跑验证，见 §19.2）
- `actor = { kind: "agent", id: accountId }`、causation/correlation 省略；
- CLI `ledger:memory-import --account <id> [--branch <b>] [--dry-run]`：global 分支 + 有 entries 的 session 分支（上限 200 branch/次，超出显式拒绝），recall → serializeState → putArtifact(MEMORY_SNAPSHOT) → append 事件；指标 `memory_import_total{result}`。

### 7.2 events 重放 reducer（`memory-projection.ts`，纯函数）

```text
按 memorySeq 升序折叠：
  memory_asserted          → facts/preferences[key] = {key, value, confidence, sourceEid: eventId, updatedAt: occurredAt}
                             decision → decisions += {description: String(value), context: key, ...}
  memory_superseded        → 移除 target 对应当前态条目（replacement 已先行存在）
  memory_retracted         → 移除 target 条目
  memory_corrected_by_user → 按 replacement 断言覆盖（用户纠正优先，§13.3）
  memory_anchor_created /
  memory_imported          → base 重置：加载 snapshotArtifactId 文档的 state；
                             仅应用 memorySeq > throughMemorySeq 的后续事件
```

- base 文档加载失败 → 该 branch 重放失败（fail-open 回 Tape + 指标），不猜测；
- 同 key 语义与 Tape fold 对齐：fact/preference 按 key 替换（confidence 取新值），decision 为时间线；
- 快照文档结构复用 `buildSummaryDocument` / MEMORY_SNAPSHOT 的 `{ state: SerializedTapeState }`。

### 7.3 读路径三态与接线

| `memory_read_path` | 行为 |
|---|---|
| `tape`（默认） | 现状：Tape recall |
| `dual` | Tape 与 events 各自 formatMemoryForPrompt，比对最终记忆块文本 hash → `memory_projection_diff_total{result=same\|different\|failed}`；注入 Tape（生产行为不变） |
| `events` | 注入 events 重放结果；任何失败 → fail-open 回 Tape + `memory_projection_diff_total{result=failed}` |

- 接线点：`loadLegacyContext` 增加 `memoryReadPath` 参数（`ChatTurnInput.memoryReadPath`，server 依 rollout 注入；`runLedger` 未启用时强制 tape——无账本证据的账号没有 events 可读）；
- canonical 路径的 memoryContext 来自 legacy 构建，自动跟随；
- Phase 5 `readMemoryCoverage`（MEMORY_SNAPSHOT 审计快照）保持 Tape 来源：它记录"Tape 投影当时状态"，与注入源解耦；manifest 口径不变；
- 门禁报告新增：`memory_read_path = events` 前建议该账号 dual 期 `memory_projection_diff_total{result=different}` 趋零（人工判断项，同 Phase 6 §6.3 的 manual 模式）。

### 7.4 Tape 的地位

`memory_read_path = events` 期间 Tape 写入继续（extractor 照常、账本先行失败仍写 Tape）——Tape 从"唯一注入源"降级为"投影之一 + events 缺口的兜底"，物理退役不在本阶段。

## 8. 重放完整性审计（`ledger:replay-audit`）

`pnpm -F @clawbot/server ledger:replay-audit --account <id> [--since <ISO>] [--until <ISO>]`，输出 JSON：

1. 窗口内每个 `run_completed` run：
   - `run_completed.payload.finalResponseArtifactId` / 各 `model_call_started.requestArtifactId` / `model_call_completed.responseArtifactId` 制品存在且 `sha256` 重算一致；
   - `storageRef` 制品经 sink 可读（inline 制品跳过）；
   - manifest（`context_compiled.payload.manifestId`）存在，`canonicalRequestHash` 为合法 sha256；
2. 覆盖率输出：`runs_total` / `runs_complete` / `runs_missing{request|response|manifest|sink}` / `coverage_ratio`，任一缺失列明细（仅 runId + artifactId，不含内容）；
3. 退出码：`coverage_ratio < 1` → 非零（审计工具，宁严勿松）；
4. 指标 `replay_audit_total{result=ok|missing_request|missing_response|missing_manifest|hash_mismatch|sink_unreadable}`。

定位：Phase 6 §21 "CANONICAL_REQUEST 制品的完整性审计"；重放执行本身 = 生产 canonical 读路径（已验证），manifest-pinned 逐点重放不在本阶段（§3）。

## 9. 数据库变更

Migration `20260903000000_add_phase_7_switches`：

1. `run_ledger_rollouts` 增加
   - `legacy_write_mode TEXT NOT NULL DEFAULT 'prompt_shaped'`（CHECK `IN ('prompt_shaped','clean','suspended')`）；
   - `memory_read_path TEXT NOT NULL DEFAULT 'tape'`（CHECK `IN ('tape','dual','events')`）；
2. 其余为零：导入事件复用 `conversation_events` / `memory_events`（JSONB payload 无 DDL）；无新表。

## 10. Observability

新增：

```text
legacy_import_total{result=appended|skipped_imported|skipped_empty|skipped_cleared|refused_no_boundary|refused_too_large|failed}
projection_write_total{mode=prompt_shaped|clean}
projection_write_skipped_total{reason=suspended}
memory_import_total{result=appended|skipped_imported|skipped_empty|failed}
memory_projection_diff_total{result=same|different|failed}
replay_audit_total{result=ok|missing_request|missing_response|missing_manifest|hash_mismatch|sink_unreadable}
```

日志白名单追加：writeMode、memoryReadPath、importedEntryCount、omittedEntryCount；禁止项不变（消息正文、prompt、记忆内容不入日志——legacy 导入的 entries 数量与字节数可以记，文本不可以）。

## 11. 错误处理

- 导入失败（校验/store）→ 该流计入 `failed`，继续其他流（CLI 逐流隔离）；整体报告退出码非零；
- legacy 条目编译不产生新 diagnostic 码（partial 是显式元数据，不是异常）；
- events 记忆重放失败 → 当次回 Tape + 指标（读路径 fail-open，与 Phase 6 §8.3 同族）；
- `clean` 模式投影变体构建失败 → 回退持久化原 assembled 消息 + warn（UI 显示退回旧行为，绝不丢行）；
- `suspended` 只跳过 `queuePersistMessage`，内存历史、rollback、seq 计数照常（重新启用时不产生 seq 冲突——DB 侧 seq 停在 suspension 点，内存 seq 领先，唯一约束仍满足）。

## 12. 安全与隐私

- 导入事件 payload 含历史正文（含当时的注入片段）——这是"诚实的 partial 历史"的代价；payload 只入 `conversation_events`（既有访问控制），不进日志与指标；
- `clean` 模式使 messages.payload 不再含 Tape 记忆与视觉观察文本——UI 投影的敏感面收窄；
- 两类导入事件的 `reconstructability=partial` 让删除策略（独立文档）第一次有了精确的"非权威历史"清单；
- 无新增 secret 面（导入不触凭证）。

## 13. 测试设计

### 13.1 Agent 单元测试

- 契约：`legacy_transcript_imported` / `memory_imported` payload 校验（非法 role、超长 text、空 entries 拒绝）；
- reducer：legacy 批量事件 → seq 0 + 合成 runId + sourceMessageSeq 排序；boundary 存在 → 丢弃；v2/v3 编译输出不含 legacy 条目（hash 回归锚）；
- compiler v4：legacy 条目 + 事实条目 + run 条目的全序；attachmentRefs unresolved；
- canonical build：legacy assistant + tool 条目配对重展开；trigger 条目映射；legacy user 媒体 → 占位符；
- 写门控：三态 × 三写点矩阵（appendMessage / tracker / appendAssistantText）；clean 投影变体形状；变体构建失败回退；
- memory projection：asserted/superseded/retracted/corrected 折叠；anchor/import base 重置 + throughMemorySeq 后事件应用；文档缺失 → 失败；
- 记忆三态：tape 现状不变；dual same/different/failed 计数；events 注入与 fail-open。

### 13.2 Server 单元测试

- 导入 CLI 边界判定：有 link / 无 link 零事件 / 无 link 有事件（refused）/ 有 boundary（skipped）/ 幂等重入；
- rollout store 新列读取与默认值；runtime 降级逻辑（clean+非 canonical → prompt_shaped + warn）；
- replay-audit：全链完整 → coverage 1；缺 request/response/manifest / hash 不匹配 / sink 不可读 → 分类计数与退出码。

### 13.3 Disposable PostgreSQL 集成测试

- fresh deploy Phase 0–7 migrations；
- 种子：账号 A 建 conversation，写 5 条 legacy messages（含 tool 配对、trigger、image assetId）→ 无 link 零事件路径导入 → 断言事件 payload/seq；
- 导入后 ingress turn（policy v4）→ canonical 编译含 legacy 条目（先于事实条目、tool 配对有效）；切 v3 编译同流 → 无 legacy 条目；
- session boundary 后编译 → legacy 条目消失；
- memory：写 Tape entries + memory_asserted → memory-import → events 重放 == Tape recall 状态；dual 比对 same；
- `legacy_write_mode = clean` + canonical turn → messages.payload user 文本 = 原文，无 visualContext；link 正常；
- read_path/memory_read_path 默认值回归（legacy/tape）。

### 13.4 回归

Phase 0–6 全部测试与 typecheck、layer check、prisma validate/migrate deploy；默认 rollout 值下全部行为与 Phase 6 逐字节一致。

## 14. 文件级实施顺序

1. 契约：conversation/memory 事件类型 + payload schema + 单测；
2. rollout migration + store 扩展 + 单测；
3. policy v4：reducer legacy 条目 + compiler v4 分支 + v2/v3 回归锚 + 单测；
4. canonical build legacy 适配（若需）+ 单测；
5. agent 写门控 port + 三写点 + 单测；
6. memory projection reducer + 读路径接线 + 单测；
7. server：legacy-import / memory-import / replay-audit 三个 CLI + 单测；
8. server 接线（runtime / agent.ts / chat-executor）+ 单测；
9. 门禁报告扩展 + 指标；
10. disposable PostgreSQL 集成测试。

每步保持 Phase 0–6 回归通过。第 7 步完成前 `legacy_write_mode`/`memory_read_path` 不得出现非默认值的使用方。

## 15. Rollout

1. fresh disposable PostgreSQL 全部 migration + 集成测试；
2. 部署 Phase 7 代码（全部默认值，导入 CLI 未执行 = 死路径）；
3. 单账号：`ledger:legacy-import`（dry-run → 实跑）→ `read_path` 经既有流程到 canonical，dual 观察legacy 条目带来的差异收敛；
4. `legacy_write_mode = clean`（同账号）→ 验证 UI 用户消息原文、对账 link 正常；
5. `ledger:memory-import` → `memory_read_path = dual` 一个观察周期 → diff 归零后置 `events`；
6. `ledger:replay-audit` 纳入周期运维（如每周）。

停止条件：

- 导入后 canonical 期 fallback 率 > 5%（读路径既有阈值）；
- dual 记忆 diff 持续无法归零且无法解释；
- clean 模式出现丢行 / link 对账 missing；
- replay-audit 覆盖率 < 100% 且缺口无法归因（制品清理策略未上线前不应出现）。

回滚：`legacy_write_mode = prompt_shaped`、`memory_read_path = tape` 立即生效；导入事件不删（事实不删，partial 标注保留审计价值）。

## 16. 验收标准

1. 默认配置下 Phase 6 行为逐字节不变；
2. `ledger:legacy-import` 幂等、边界判定覆盖 §5.2 全部分支、导入后 canonical（v4）上下文包含 legacy 条目且位于事实条目之前；
3. v2/v3 编译输出与 Phase 4/6 快照逐字节一致（legacy 条目不进入 v≤3）；
4. `/clear` 后 legacy 条目不再出现在编译窗口；
5. `clean` 模式下 messages.payload 的 user 消息为原文，Web UI 显示原文，link 对账不受影响；
6. `memory_read_path = events` 的注入与 Tape recall 在导入+重放后语义等价（dual same）；
7. `ledger:replay-audit` 对完整窗口输出 coverage 1，人工抽掉制品后能分类报缺；
8. Phase 0–6 全部回归通过。

## 17. 实际文件范围（实现后核对）

### Agent

```text
M packages/agent/src/shared/fact-ledger/contracts.ts     # legacy_transcript_imported / memory_imported 契约 + LEGACY_TRANSCRIPT_MAX_ENTRIES
M packages/agent/src/shared/fact-ledger/index.ts         # 导出新增契约与 ids
A packages/agent/src/shared/fact-ledger/ids.ts           # settle 侧纯 id 派生（自 engine 下沉，修 Phase 6 层级违规）
M packages/agent/src/context-compiler/types.ts           # policy v4 常量 + entry reconstructability/sourceMessageSeq
M packages/agent/src/context-compiler/conversation-reducer.ts  # legacy 条目派生 + boundary 丢弃
M packages/agent/src/context-compiler/compiler.ts        # v4 门控（v≤3 过滤 legacy 条目）+ v3 extras 扩展到 v4
M packages/agent/src/engine/context-build/index.ts       # MemoryReadPath 类型
M packages/agent/src/engine/context-build/legacy.ts      # memoryReadPath 接线（tape 缺省逐字节不变）
A packages/agent/src/memory/memory-projection.ts         # events 重放 reducer（base 重置 + fold）
M packages/agent/src/ports/projection-write.ts           # 写模式解析器（新增）
M packages/agent/src/engine/turn.ts                      # 三写点门控 + clean 投影变体 + memoryReadPath 透传
M packages/agent/src/engine/conversation/cache.ts        # appendAssistantText 门控
M packages/agent/src/engine/run-ledger/ids.ts            # settle 侧 id 下沉为 shared re-export
M packages/agent/src/capabilities/outbound-facts.ts      # 改从 shared 导入 id（层级修复）
M packages/agent/scripts/check-layers.mjs                # outbound-facts 入 RANK
M packages/agent/src/index.ts                            # 导出（policy v4 / MemoryReadPath / projection-write / memory-projection 等）
A packages/agent/test/context-compiler/legacy-import.test.ts   # 契约/reducer/v4 门控/canonical 配对/写模式
A packages/agent/test/memory/memory-projection.test.ts         # events 重放折叠语义
M packages/agent/test/context-compiler/compiler.test.ts        # 未知 revision 用例 v4→v5
```

### Server

```text
M packages/server/prisma/schema.prisma                   # legacy_write_mode / memory_read_path
A packages/server/prisma/migrations/20260903000000_add_phase_7_switches/migration.sql
M packages/server/src/db/run-ledger-rollout-store.ts     # legacyWriteMode / memoryReadPath 读取
M packages/server/src/db/tape-store.impl.ts              # 构造器支持注入（CLI/测试）
M packages/server/src/runtime.ts                         # 快照 + clean 降级 + memory 路径门控 + 全局 resolver
M packages/server/src/agent.ts                           # 编译闭包 v4 + memoryReadPath 注入
M packages/server/src/db/chat-executor.impl.ts           # trigger 编译 v4 + memoryReadPath
M packages/server/src/db/chat-executor.impl.test.ts      # v4 断言 + fake rollout 扩展
A packages/server/src/ledger-legacy-import.ts            # legacy-import CLI（幂等优先边界判定）
A packages/server/src/ledger-legacy-import.test.ts
A packages/server/src/ledger-memory-import.ts            # memory-import CLI
A packages/server/src/ledger-memory-import.test.ts
A packages/server/src/ledger-replay-audit.ts             # replay-audit CLI
A packages/server/src/ledger-replay-audit.test.ts
M packages/server/src/ledger-gate-report.ts              # legacy_import_coverage 核查
M packages/server/package.json                           # ledger:legacy-import / memory-import / replay-audit scripts
A packages/server/test-integration/legacy-boundary-phase-7.test.ts  # disposable PG 全链路
M packages/server/test-integration/fact-ledger-stores.test.ts       # 修 Phase 1 遗留的不可重跑缺陷（§19.3）
```

### Observability

```text
M packages/observability/src/metrics/agent-metrics.ts    # §10 六个新指标
M packages/observability/src/metrics/index.ts
M packages/observability/src/index.ts
```

## 18. 风险与开放问题

1. **legacy 条目体积**：单批上限 500 条（默认）控制编译体积；超大历史省略最旧内容并显式计数——对模型可见的历史突然"从中间开始"是 partial 的固有代价，dual 期观察；
2. **导入可见性延迟**：流上已有事件时，导入后首个 turn 起才生效（§5.2）；不重排既有事件 seq；
3. **`clean` 与 `/clear` 投影**：clear 走既有 link `state=cleared` + boundary，clean 变体不影响该流程；对账口径不变；
4. **events 记忆与 Tape 漂移**：trigger run 只写 Tape 不写账本（契约不变）→ events 重放缺 pulse 学到的记忆，`memory_imported` 只能补偿导入时刻之前的缺口；若 pulse 场景记忆重要，后续需独立的 trigger-run 记忆事件设计（记录为开放问题，不放宽证据链）；
5. **`suspended` 与 seq**：长期 suspended 后恢复写会产生 seq 间隙与 `conversations.message_count` 口径漂移——suspended 定位为 UI 切换后的终态而非可逆暂停，文档化；
6. **旧图片重放**：依赖后续把存量 asset 映射进 `ConversationAttachmentArtifact`（可作独立小任务），本阶段一律占位符。

## 19. 实施后核对（一次性 PostgreSQL 冒烟 + 回归）

### 19.1 三个 CLI 端到端冒烟

环境：一次性 PostgreSQL（`postgres:16`，`phase7-pg-test`，fresh deploy Phase 0–7 全部 7 个 migration）。
CLIs 走 `getPrisma()`，需要同时设置 `DATABASE_URL` 与 `DIRECT_URL`（`ensurePrismaUrls()` 两个都要求），
与 `FACT_LEDGER_TEST_DATABASE_URL` 无关。

| CLI | 结果 |
|---|---|
| `ledger:legacy-import`（dry-run） | `dry_run`，entryCount 5、omitted 0 |
| `ledger:legacy-import` | `appended`，eventId `legacy-import-v1:87aa…` |
| `ledger:legacy-import`（重跑） | `skipped_imported`——幂等命中，未退化成 `refused_no_boundary`（§5.2 修复点成立） |
| `ledger:memory-import`（dry-run） | `dry_run`，snapshotArtifactId `memory-snapshot-v1:d014…` |
| `ledger:memory-import` | `appended` |
| `ledger:memory-import`（重跑） | 修复前 = `failed`（id 冲突）；修复后 = `skipped_imported` |
| `ledger:replay-audit`（完整 run） | `coverage_ratio: 1`，4 个制品全部校验通过，退出码 0 |
| `ledger:replay-audit`（缺制品 run） | `coverage_ratio: 0`，`missing_request: 1` / `missing_response: 2`，退出码 1 |

导入事件 payload 落库核对：user 条目保留组装文本原样（含当时的时间与记忆注入）、`attachmentRefs: ["asset-1"]`、
tool 条目从配对 assistant 的 toolCall block 回查出 `toolArguments: {"city":"上海"}`、纯 toolCall 轮以空文本保留
（`keepEvenIfEmpty`）、trigger 原样、`reconstructability: "partial"`、`boundaryMessageSeq: 5`——与 §5.1 一致。

### 19.2 冒烟发现并修复的两个 CLI 缺陷

1. **`ledger:memory-import` 不幂等**：`throughMemorySeq` 随每次导入前进，导致同 eventId + 不同 payload，
   id-retry 判为冲突 → `result: failed`、退出码 1。改为写入前按 eventId 预探测（见 §7.1 新增条目）。
2. **`--dry-run` 有副作用**：制品 `put` 排在 dry-run 分支之前，预览也会写库。改为 dry-run 前置返回，
   制品写入移到 append 之前。

另修 `runMemoryImport` 丢弃 `options.tapeStore`（未透传给 `importMemoryBranch`）。

### 19.3 附带修掉的测试隔离缺陷（Phase 1 遗留）

`test-integration/fact-ledger-stores.test.ts` 的"artifacts are globally content-addressed"用例用
`sha256CanonicalJson(null)` 作为内容。制品按内容全局去重（跨账号、跨批次），该常量内容在整个库里
**只能被 append 一次**：

- 第一次跑：54/54 通过；
- 第二次跑（同一库）：`first.appended === false`，该用例失败；连带"immutable rows reject update and
  delete"里 `DELETE FROM artifact_revisions WHERE artifact_id = 'artifact-<nonce>-1'` 匹配不到行、
  触发器不触发、`assert.rejects` 报 `Missing expected rejection`。

即 disposable PostgreSQL 集成测试**不可重跑**，会掩盖真实回归。修法：把"内容寻址去重"与
"inline null 保留"两个关注点拆开——去重用 `nonce` 化内容（每 run 唯一），null 保留只断言
`inlineJson === null` 不断言 `appended`（其 hash 是常量，行可能已存在）。修复后同一库连续两轮
均 54/54。

### 19.4 全量回归

| 项 | 结果 |
|---|---|
| agent 单测 | 341/341 |
| server 单测 | 136/136 |
| 集成测试（fresh DB / 重跑） | 54/54、54/54 |
| 8 个包 `tsc --noEmit` | 全通过 |
| 集成测试 `tsc --noEmit` | 通过 |
| `check-layers` | 141 files, no violations |
| `prisma migrate deploy`（fresh DB） | 7 个 migration 全部应用 |

生产 Supabase 库在核对时不可达（Prisma `P1001`，基础设施问题而非代码问题），
additive migration 尚未部署到生产库——部署前需恢复连通性后重跑 `prisma:migrate:deploy`。
