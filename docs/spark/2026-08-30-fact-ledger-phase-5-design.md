# Fact Ledger Phase 5：Memory Facts 与 Media/Summary 制品 —— Coverage 补全

> 状态：设计完成 / 可进入实施
> 日期：2026-08-30
> 前置：Phase 4 Run Ledger、正式 Context Manifest、policy v2 run facts 与 disposable PostgreSQL 集成测试已通过
> 范围：补全 manifest coverage 的最后三个缺口——Memory Event 正式写入（memoryFacts）、attachment source ref → immutable MEDIA_ASSET 映射与 vision observation 制品（immutableMediaArtifacts）、compaction SUMMARY 制品（summaryArtifactIds）；仍为 expand-only 写侧阶段，不切换生产读取源

## 1. 决策摘要

Phase 5 采用以下方案：

1. Memory Event 双写：Tape 提取产物在写 Tape 的同一异步流程内追加 `memory_asserted`；同一 key 出现不同 value 时追加 `memory_superseded` 引用新旧两个确定性断言 id；不做 Tape 历史回填迁移（Tape 保留为运行时投影，Memory Event 从现在起积累）；
2. Memory Event 的证据链来自事实账本自身：`sourceConversationEventIds = [user inbound eventId]`（**只放 conversation 事件**，assistant 侧证据经 `sourceRunId` 解析 run 链）、`sourceRunId = runId`、`extractionModelRevisionId + extractionPromptRevisionId` 以 Phase 4 的 revision 制品固定；
3. Manifest 记忆字段开始有真实值：`memoryEventWatermark = wm-v1:<globalSeq>/<sessionSeq>`、`memoryArtifactId` 指向 MEMORY_SNAPSHOT 制品（global + session 双 branch 快照，"as of compile time"）；
4. 媒体映射落地：ingress 媒体资产化时计算文件 sha256，写 MEDIA_ASSET 制品（字节经 content sink 外置）与 `conversation_attachment_artifacts` 映射表（source ref → artifactId）；`AttachmentArtifactResolver` 从 unresolved 默认实现切换为 server 真实实现，canonical attachments 开始出现 `resolved`；
5. Vision observation 进入 VISUAL_OBSERVATION 制品并填充 `manifest.visualObservationIds`；canonical entry 文本不变（视觉 fallback 仍是 legacy 侧启发式类别）；
6. Compaction SUMMARY 制品化：checkpoint 快照文档进入 SUMMARY 制品，追加 `memory_anchor_created` 事件引用它；`summaryArtifactIds` 填充（"as of compile time"，引用本次 run 之前产生的 summary）；
7. coverage 语义明确：`memoryFacts` / `immutableMediaArtifacts` 由 bootstrap 按本 run manifest 的实际内容置位，不再恒为 false；policy 保持 `context-policy-v2` 不变（entries 语义零变化）；
8. Rollout 复用既有 `run_ledger_rollouts` 单开关（所有 Phase 5 写入都服务于 canonical 写路径，不再按子特性拆表）；
9. Phase 5 仍是 expand-only。辅助 run 源接线（scheduler/heartbeat/主动推送）、diff 最终收敛与生产读取切换全部留给 Phase 6。

## 2. 目标

Phase 5 完成后，系统具备下面的并行链路：

```text
Chat turn (run ledger enabled)
  -> bootstrap (Phase 4) +
       memory watermark/snapshot 读取（as of compile time）
       MEMORY_SNAPSHOT artifact put
       manifest.memoryEventWatermark / memoryArtifactId / summaryArtifactIds
  -> AgentRunner loop (Phase 4 不变)
  -> handleRunResult:
       compaction 命中阈值 → SUMMARY artifact + memory_anchor_created 事件

Async extraction lane (fire-and-forget, Phase 4 既有)
  -> canonical turn input（user/assistant entry 文本）
  -> extraction LLM（revision 固定）
  -> Tape 串行队列任务（derive → memory_asserted / memory_superseded → MemoryEventStore，
       随后 Tape 写入——账本先行，队列内严格串行）

Media ingest (server, chat asset attach)
  -> file sha256 → MEDIA_ASSET artifact（sink 外置）
  -> conversation_attachment_artifacts[source_ref] = artifact_id
  -> resolver: sourceRefs → resolved attachments（policy v2）
```

必须满足：

1. Memory Event 与 Tape 写入的最终一致：同一提取产物要么两边都落，要么都记失败指标；Memory Event 写失败不影响 Tape（反之亦然），不阻塞生产；
2. `memory_asserted` 幂等：同 run、同前值、同值的重放得到同一 eventId（id 含 prevHash 与 sourceRunId），Store id-retry 语义吸收；同值重提取被 skip 规则拦下不产生事件；value 变化才产生 superseded + 新断言，翻转（A→B→A）永不与历史断言 id 冲突；
3. `memory_superseded` 的 `targetMemoryEventId` / `replacementMemoryEventId` 都可独立解析回真实事件；
4. 媒体映射写入与资产创建在同一失败域：资产创建成功而映射失败 → 该 ref 保持 unresolved（可观测），不猜测、不回填；
5. MEDIA_ASSET 制品内容寻址于文件字节（sha256 = 文件字节哈希），同文件多消息共享制品（getByContent 去重）；
6. manifest 的记忆/summary 字段语义为 "as of compile time"：本 run 自身产生的记忆/summary 不出现在自己的 manifest 里（与 runEventIds 同规则）；
7. v2 canonical entries、hash、memory input 的既有语义逐字节不变——Phase 5 只让 coverage 与 manifest 字段从空变实，不动 entries；
8. 全部新增写失败 fail-open，指标 + 结构化日志，不阻塞模型调用、回复、settle、cursor。

## 3. 非目标

Phase 5 不做：

- 生产读取切换（Phase 6）；
- scheduler / heartbeat / 主动推送 / API chat 的 run ledger 接线（Phase 6）；
- outbound 媒体（TTS、生成图片）的 artifact 映射（Phase 6 与 outbound facts 富化一起）；
- `memory_corrected_by_user` / `memory_retracted` 事件（需要显式用户纠正交互，独立设计）；
- Memory Event 反向重建 Tape（Tape 仍是运行时投影，Memory Event 是审计与未来重放的事实源）；
- 历史 Tape 数据回填为 Memory Event（只从 Phase 5 起积累，切换门禁按"自启用以来的覆盖"评估）；
- 视觉 observation 的重放执行或媒体重渲染；
- Memory Extraction 输入从 legacy turn 切换为 canonical context 的"语义重写"——Phase 5 只是把同一 turn 的文本替换为 canonical entry 文本（值等价）并补齐证据链字段；
- Web UI 与公开 HTTP API。

## 4. 方案比较

### 4.1 方案 A：一次性把 Tape 全量翻译成 Memory Event

好处是切换门禁时 Memory Event 覆盖全部历史。坏处：Tape 存量缺少 sourceConversationEventIds（事件引用是后验的、可能已不存在）、无法满足 `sourceConversationEventIds: min(1)` 的证据链要求，只能伪造引用——违背事实账本原则。

不采用。

### 4.2 方案 B：Memory Event 作为唯一存储，Tape 退役

把运行时投影（Tape fold/anchor/compaction）压到事件重放上，工程量与风险远超 Phase 5 承载力，且 read switch 之前 Tape 仍是生产路径。

不采用。

### 4.3 方案 C：双写 + 制品化 + manifest 填充（采用）

Tape 照旧服务生产读取；Memory Event 从新积累作为审计事实；media/summary/vision 制品补全 manifest。切换评估（Phase 6）基于"自启用以来的双写覆盖 + shadow 收敛"，对 Tape 存量的处理留给切换阶段专门决策。

采用。

## 5. Memory Event 写入

### 5.1 写点与触发

写入整体进入**既有的 Tape 串行队列任务**（`memory/queue.ts` 的 FIFO，`flushing` 互斥）——derive、事件写入、Tape 写入三步在同一个队列任务内完成，从根本上消除并发提取对同一 key 的竞态（两个 extraction lane 不会交错执行同一 branch 的 derive）：

```text
extraction LLM → memories[]
  → 批内去重：同 (category, key, value) 只保留 confidence 最高的一条
  → for each memory，入队一个任务，任务内串行执行：
       branch = scope === "global" ? GLOBAL_BRANCH : sessionBranch
       valueHash = sha256CanonicalJson(value)
       previous = 队列任务内重新 recall 的该 key 当前 Tape 值
       if previous 存在且 canonicalizeJson(previous.value) === canonicalizeJson(value):
            skip（幂等，不产生事件）
       if previous 存在且值不同:
            append memory_superseded { targetMemoryEventId: findLiveAssertionByKey 校验后的旧断言 id,
                                       replacementMemoryEventId: derive(new) }
       append memory_asserted
       queueRecordEntry 的 Tape 写入（同队列既有行为）
```

**顺序统一为账本先行**：Memory Event 先于 Tape 写入，与 Phase 2 "ingress 先落事实、投影随后" 的原则一致。两者是独立失败域（§5.3），顺序不影响正确性，但决定了失败组合的语义：事件成功 + Tape 失败 = 投影缺口（Tape 队列自带指数退避重试），由指标暴露；事件失败 = 该条记忆放弃入账，Tape 照常写（生产记忆功能不受影响）。

### 5.2 确定性 id 与 payload

断言事件表达"在某次 run 中，key 的值从 prev 变为 value"——因此 id 同时包含前后值哈希与 sourceRunId，保证幂等重试同 id、翻转/证据更新产生新事件且永不冲突：

```text
prevHash = sha256CanonicalJson(previous.value)   # 无前值（新 key）时为字面量 "initial"

memory_asserted eventId:
  memory-event-v1:<sha256(accountId + NUL + branch + NUL + category + NUL + key
                          + NUL + prevHash + NUL + valueHash + NUL + sourceRunId)>

memory_superseded eventId:
  memory-event-v1:<sha256(accountId + NUL + branch + NUL + key + NUL + "superseded"
                          + NUL + prevHash + NUL + valueHash + NUL + sourceRunId)>
```

幂等语义由此唯一确定：

- 同 run 重试（receipt 重投 → 同 runId）→ 同 id，Store id-retry 吸收；
- 同值重提取 → §5.1 skip 规则拦下，不产生事件（证据链不更新——值未变，观察无新信息）；
- 翻转（A→B→A）→ 每次翻转的前值不同，产生新事件链，永不与历史断言 id 冲突。

**confidence 与 id 的关系（有意排除）**：id 不含 confidence、sourceConversationEventIds 与 extraction revisions——confidence 是软评分不是身份，进 id 会让评分抖动刷出新事件。组合防线：

1. 批内去重（§5.1）保证同 run 同 key 同 value 至多一条、取最高 confidence；
2. 跨 run 同值 → sourceRunId 不同 → 天然是新断言事件，无冲突；
3. 残余冲突（如重投重跑的 extraction 输出置信度不同 → 同 id 不同 payload）→ Store 抛 `FactLedgerIdConflictError`，**显式按 fail-open 处理**：记 `memory_event_total{result=conflict}`、跳过事件、Tape 照常——既有事件是权威版本。

`memory_asserted` payload 严格按 Phase 1 `memoryAssertionSchema`：

| 字段 | 取值 |
|---|---|
| `category` / `scope` / `key` / `value` / `confidence` | extractor 输出原样 |
| `sourceConversationEventIds` | `[inbound eventId]`——**只放 conversation 事件**；assistant 侧证据经 `sourceRunId` 解析（run 链的最终 model_call_completed → MODEL_RESPONSE 制品），不把 run event id 混入本字段 |
| `sourceRunId` | runId（Phase 4 确定性派生；无 ledger 的 turn 无证据链 → 整条放弃写事件，只写 Tape） |
| `extractionModelRevisionId` + `extractionPromptRevisionId` | 成对必填：extractor 模型的 MODEL_CONFIG_REVISION + `memory_extract` prompt 资产的 PROMPT_REVISION（Phase 4 制品 helper 复用） |

envelope：`branch = scope 对应分支`、`actor = { kind: "agent", id: accountId }`、`causationId = sourceRunId`、`correlationId = sourceConversationEventIds[0]`。

`memory_superseded` payload：`{ targetMemoryEventId, replacementMemoryEventId, reason: "value_updated" }`。target 的解析：断言 id 含旧断言自身的 prevHash 与 sourceRunId，无法仅从 Tape 当前值重算——通过 `MemoryEventStore.findLiveAssertionByKey(accountId, branch, category, key)`（Port 新增方法，语义见 §10）取得该 key 当前的 live 断言，并校验其 value 与 previous Tape 值 canonical 相等后才引用；查无事件（Tape 存量 key）或值不一致 → 只写 asserted，不写 superseded——没有证据链的 target 是伪造引用。

### 5.3 失败语义

两个独立失败域，顺序为账本先行：

- **事件域**：Memory Event append 失败 → 该条记忆放弃入账（skip 事件），`memory_event_total{result=failed}` + 日志；**Tape 写入照常执行**（生产记忆功能不受影响）；
- **投影域**：事件成功 + Tape 写入失败 → Tape 队列自带指数退避重试；重试耗尽 → 投影缺口，由 `memory_event_total` 与 Tape 写失败指标的差值暴露；
- revision 制品 put 失败：本批记忆事件放弃写入（证据链不完整的事件不写），Tape 照常；
- `memoryEventsEnabled` 由 `run_ledger_rollouts` 统一开关；
- **并发正确性**由 §5.1 的队列内串行保证：同一 key 的并发提取在队列中严格串行，每个任务读到的 previous 是前一个任务的最终结果，superseded 链永远可双向解析（集成测试覆盖"同 key 并发提取不同值"）。

## 6. Manifest 记忆字段

### 6.1 Watermark

```text
memoryEventWatermark = "wm-v1:<globalLastSeq>/<sessionLastSeq>"
```

bootstrap 的 compile 阶段（enqueueWrite 内）读取两个 branch 的当前 memorySeq（MemoryEventStore 增加 `headSeq(accountId, branch): Promise<number>` Port 方法，server 实现 `memory_events` head 查询）；无任何事件 → `wm-v1:0/0`。语义：**本 manifest 编译时刻**两个 branch 已落库的最后 memorySeq。

### 6.2 MEMORY_SNAPSHOT 制品

```json
{
  "watermark": "wm-v1:12/3",
  "branches": { "global": <serializedState>, "session": <serializedState> }
}
```

- `artifactId = memory-snapshot-v1:<sha256(accountId + NUL + runId)>`（内容含 runId，逐 run 唯一，不用内容哈希以免与 watermark 时间性冲突）；
- `serializedState` 复用 Tape fold 的 `serializeState`（与 `<memory>` 注入内容同源，重放可重建注入文本）；
- put 失败 → manifest 的 memory 字段整体留空（watermark 回退 `"unavailable-v1"`），run 不降级——memory 字段是增益信息，不是 manifest 必备项（区别于 Phase 4 的 revision 缺失即降级）。

### 6.3 时机语义

快照与 watermark 读取发生在 bootstrap（模型调用前），本 run 提取的新记忆不在内——与 Phase 4 `runEventIds` 的 "先前事实" 规则一致。

## 7. Media Artifact 与映射

### 7.1 写点

server `attachAssetIdToMedia`（ingress 媒体资产化路径）在 `createFromFile` 成功后执行制品化与映射。该函数当前签名不含 source 信息——**增加 `sourceRef?: string` 参数**，由 `chat()` 在 ingress 路径传入 `source.payload.attachmentRefs[0]`（media 存在且 source 为 ingress 事件时；非 ingress 或无媒体 → 不传，行为回落 Phase 4）：

```text
fileBytes → sha256（文件字节）
MEDIA_ASSET 制品 put：
  artifactId = media-asset-v1:<fileSha256>          # 内容寻址，同文件去重
  sha256 = fileSha256
  storageRef = contentSink.put("media_asset/<fileSha256>.bin", fileBytes)   # 字节外置
映射写：
  INSERT conversation_attachment_artifacts (account_id, source_ref, artifact_id, media_kind, created_at)
  source_ref = source.payload.attachmentRefs[0]
```

- **Phase 5 只映射实际进入 `ChatRequest.media` 的那一个媒体项**，即 `attachmentRefs[0]`；其余 ref 保持 unresolved——当前 SDK 每消息只下载/资产化第一个媒体项，为不存在的资产建映射才是伪造。多媒体支持落地后按 ref 全量扩展；
- 制品与映射写在同一 try 域；制品成功、映射失败 → ref 保持 unresolved + `media_mapping_total{result=failed}`（不猜测、不回填）；
- 文件读取/sha256 失败 → 跳过整个媒体制品化，行为回落 Phase 4；
- `media_asset` 的 sink key 扩展允许 `.bin` 后缀（key 正则从 `\.json$` 放宽为 `\.(json|bin)$`）。

### 7.2 Resolver 真实实现

```ts
// server
export function createPrismaAttachmentArtifactResolver(deps: {
  prisma?: PrismaClient;
  artifactRevisionStore: ArtifactRevisionStore;
}): AttachmentArtifactResolver
```

- 输入 `sourceRefs` → 映射表批量查询 → artifactId → `getById` 验证存在（Phase 3 §6.2 的既有约束）→ 返回 `{ artifactId, mimeType? }`；
- mimeType 取 MEDIA_ASSET 制品旁路数据？制品文档只有字节——mimeType 从映射表读取（建表时从 ChatRequest.media.mimeType 记录），避免为 mimeType 再读制品字节；
- 无映射 / 制品缺失 → 该 ref 不出现在返回 Map（compiler 既有逻辑自动落到 unresolved）；
- resolver 返回集合外的 ref 检查、artifact 存在性校验（Phase 3 已实现）不变。

### 7.3 历史与边界

- 映射只从 Phase 5 起积累；历史 `weixin-attachment-v1:*` ref 无映射 → 永远 unresolved（已解释类别，不回填——与 Memory 同一原则）；
- 多媒体消息的其余 ref 保持 unresolved，直到多媒体下载/资产化支持落地（§7.1 边界）；

## 8. Vision Observation 与 Summary 制品

### 8.1 VISUAL_OBSERVATION

- 写点：`buildUserMessage` 内 `prepareUserVisualContent` 产出 `VisualContext[]` 后（agent L5，run ledger 开启时）；
- 文档：VisualContext 原样序列化（provider/modelId/generatedAt/summary/ocrText/objects/…）；
- `artifactId = visual-observation-v1:<sha256CanonicalJson(doc)>`，inline；
- 写入经 recorder 队列（turn 层在 buildUserMessage 之后、bootstrap 之前 pin，ids 传入 runner ledger → manifest.visualObservationIds）；
- canonical entry 文本不包含 observation 内容（事件文本才是模型可见历史；vision fallback 文本由 legacy 侧启发式类别吸收）；
- 失败：fail-open，manifest 字段留空。

### 8.2 SUMMARY 与 memory_anchor_created

- 写点：`compactIfNeeded` 的 `compactTransaction` 成功后（异步，不阻塞回复）；
- SUMMARY 制品文档：`{ branch, anchorType: "checkpoint", state: <serializedState>, entryIds: <manifest>, createdAt }`，`artifactId = summary-v1:<sha256CanonicalJson(doc)>`；
- 追加 `memory_anchor_created`：`payload.snapshotArtifactId = summary 制品 id`、`throughMemorySeq = 当前 branch watermark`、causationId = anchor id；
- 失败：fail-open，Tape anchor 照常（Memory Event 缺口由指标暴露）。

### 8.3 manifest.summaryArtifactIds

bootstrap compile 阶段查询 Tape anchors（`findLatestAnchor` 链）中已制品化的 summary——Phase 5 起新 anchor 才有制品；旧 anchor 无制品 → 不引用（不伪造）。实现：Tape anchor 行增加可空 `summaryArtifactId` 列（migration）或按 anchor createdAt 反查 SUMMARY 制品？选择**加列**（migration 给 `tape_anchors` 加 nullable `summary_artifact_id` TEXT），查询确定、无时间性猜测。

## 9. Coverage 与 manifest 组装

bootstrap 新增输入（全部 "as of compile time"）：

| manifest 字段 | Phase 5 取值 | 失败回退 |
|---|---|---|
| `memoryEventWatermark` | `wm-v1:<g>/<s>`（MemoryEventStore.headSeq） | `"unavailable-v1"` |
| `memoryArtifactId` | MEMORY_SNAPSHOT 制品 id | 不设 |
| `summaryArtifactIds` | 已制品化 anchors 的 SUMMARY ids | `[]` |
| `visualObservationIds` | 本 run buildUserMessage 产出的 observation 制品 ids | `[]` |
| coverage.memoryFacts | memoryArtifactId 存在 | — |
| coverage.immutableMediaArtifacts | 本 manifest 引用的 resolved attachment/observation 至少一个，或恒为 true？ | 见下 |

**coverage 语义收窄（实际覆盖，不是能力声明）**：coverage 描述"本 manifest 实际引用了什么"，给 Phase 6 切换门禁提供真实信号——能力开启但映射全失败时不得报 true：

- `immutableMediaArtifacts` = 本 manifest 实际引用了至少一个不可变媒体制品（entries 中出现 resolved attachment，或 visualObservationIds 非空）；
- `memoryFacts` = memoryArtifactId 存在（快照真实写入）；
- 两者都由 bootstrap 实际产出驱动，不引入 policy v3——entries 与 hash 语义零变化，coverage 从常量变为产物事实。

CanonicalContextV1 的 coverage 类型从字面量放宽为 boolean（Phase 4 已放宽 conversation/assistant/tool 三项，Phase 5 放宽剩余两项）。

## 10. Agent 模块边界

MemoryEventStore Port 扩展（L1）：

```ts
headSeq(accountId: string, branch: string): Promise<number>;
/**
 * 返回该 key 当前 live 的断言事件。
 *
 * 语义契约是 "live"（未被后续事件替换的最新 memory_asserted），不是字面的
 * "最后一条 asserted"：Phase 5 中 superseded 总是与更新的 asserted 成对出现，
 * 实现可落为按 memorySeq 倒序的最新 asserted；未来引入 memory_retracted /
 * memory_corrected_by_user 时必须更新本实现，调用方不变。
 */
findLiveAssertionByKey(
  accountId: string,
  branch: string,
  category: "fact" | "preference" | "decision",
  key: string,
): Promise<MemoryEvent | null>;
```

查询策略：`memory_events` 增加冗余列 `category` / `key`（同事务随 append 写入；superseded/anchor 行为 NULL，天然被等值查询排除），并建索引 `(account_id, branch, category, key, memory_seq)`——`findLiveAssertionByKey` 走索引前缀等值 + `memorySeq DESC` 取一，避免 JSONB 全表扫描。不采用 JSONB 表达式索引（Prisma 无法表达）与 live 投影表（引入第二一致性域；Phase 6 memory projection 时再评估）。

```text
packages/agent/src/memory/                 # L3
  fact-writer.ts        # memory_asserted/superseded 事件构建与双写（纯构建 + Port 调用）
  summary-artifacts.ts  # SUMMARY 制品文档构建

packages/agent/src/engine/run-ledger/      # L5
  memory-bootstrap.ts   # watermark 读取 + MEMORY_SNAPSHOT put + manifest 字段填充
  （bootstrap.ts 扩展输入）

packages/agent/src/context-compiler/       # L3
  （coverage 类型放宽；resolver/编译逻辑零变化）
```

- `fact-writer` 需要 MemoryEventStore（L1 Port）+ 证据链入参；derive、事件写入与 Tape 写入整体进入既有 Tape 串行队列任务（§5.1）；
- server 新增：

```text
packages/server/src/db/conversation-attachment-artifacts.ts   # 映射表访问 + 批量查询
packages/server/src/db/prisma-attachment-artifact-resolver.ts # 真实 resolver
packages/server/src/db/memory-event-store.impl.ts             # +headSeq、+findLiveAssertionByKey
```

- layer check：memory（L3）新增对 ports 的既有向下依赖；无新 exemption。

## 11. Shadow 对比扩展

- `canonical_unresolved_attachment`：新 ingress 媒体消息开始 resolved → 该类别对新增流量趋零；历史 ref 恒 unresolved（已解释，不收敛到零，Phase 6 读取切换评估时按"启用之后"口径统计）；
- `legacy_user_has_tape_memory` / `legacy_user_has_visual_fallback`：不变（canonical entry 不含 memory/visual 注入文本，legacy 侧启发式照旧分类）；
- 其余类别与 Phase 4 相同；`unclassified_difference` 继续为收敛目标。

## 12. Observability

新增低基数指标：

```text
memory_event_total{result=appended|skipped_unchanged|failed}
memory_superseded_total
media_artifact_total{result=appended|reused|mapping_failed|failed}
media_mapping_total{result=ok|failed}
visual_observation_total
summary_artifact_total
run_ledger_inline_latency_ms（沿用，bootstrap 新增读取计入）
```

允许日志字段：accountId、runId、branch、memorySeq、artifactId、sourceRef（hash 派生 id，非正文）、计数。禁止：memory value 正文、prompt、媒体路径、vision summary 正文。

## 13. 数据库变更

新增 migration `20260830200000_add_ledger_coverage_phase_5`：

1. 创建 `conversation_attachment_artifacts`：
   - `account_id` + `source_ref` 组成 PK（ref 派生含 accountId，天然账户隔离）；
   - `artifact_id`、`mime_type`、`created_at`；
   - FK `(account_id, artifact_id)` → `artifact_revisions (account_id?) `——Phase 1 artifact 表无 account 维度（全局内容寻址）→ 只做应用层校验 + `artifact_id` 普通列，不加 FK；
   - INDEX `(artifact_id)`；
2. `tape_anchors` 增加 nullable `summary_artifact_id TEXT`（加列，不回填）；
3. `memory_events` 增加 nullable 冗余列 `category TEXT` / `key TEXT`（`memory_asserted` 行同事务写入这两列，`memory_superseded` / `memory_anchor_created` 行为 NULL，天然被等值查询排除）+ 索引 `(account_id, branch, category, key, memory_seq)` 服务 `findLiveAssertionByKey`；
4. 其余为零：无新 rollout 表，run/artifact 表 Phase 1/4 已建。

Phase 1 的 `memory_events` append-only trigger 直接保护 Phase 5 写入（集成测试断言）。冗余列与 payload 同事务写入，不构成第二一致性域。

## 14. 错误处理

- 全部 Phase 5 写入 fail-open：Memory Event / 媒体映射 / observation / summary 任一失败只降级自身，不影响 Tape、模型调用、回复、settle、cursor；
- 证据链不完整（无任何 source event/run id）→ 不写 Memory Event，只写 Tape + 指标（宁缺毋假）；
- 映射唯一冲突（同 ref 重复资产化）：`ON CONFLICT DO NOTHING` 语义，幂等返回既有映射；
- superseded 的 target 解析失败（旧断言不存在）：放弃 superseded，只写 asserted + `memory_superseded_total{result=orphan_target}` 计数（防御性，正常不发生）；
- MEMORY_SNAPSHOT put 失败 → manifest memory 字段回退（§6.2），不降级 run。

## 15. 安全与隐私

- memory value / vision summary / summary state 是用户内容，进入事实账本与制品——访问控制与 legacy Tape 同级，不进日志；
- `source_ref` 是哈希派生 id，可入日志；
- 媒体字节经 sink 落盘（本地目录），与 legacy 媒体缓存同级保护；删除策略仍待独立设计（Phase 3 §16 的既有立场不变）；
- rollout 复用 `run_ledger_rollouts`：开启即同意记忆/媒体/summary 三类内容写入账本。

## 16. 测试设计

### 16.1 Agent 单元测试

- fact-writer：asserted 确定性 id（含 prevHash + sourceRunId）与 NUL 拼接；同值幂等 skip；值变化产生 superseded 且 target/replacement 可解析；翻转（A→B→A）id 永不冲突；证据链缺失放弃写事件；revision put 失败放弃整批；
- 批内去重：同 (category, key, value) 多条只保留最高 confidence；
- id 冲突（同 id 不同 payload，如重投重跑的 confidence 抖动）→ `memory_event_total{result=conflict}` + skip + Tape 照常；
- `findLiveAssertionByKey`：live 语义（最新 asserted 未被 superseded 替换）；superseded 行（category/key 为 NULL）不被等值查询命中；
- **并发正确性**：同一 key 并发提取不同值——队列内串行后 superseded 链可双向解析、Tape 终态与最后一跳一致；
- memory event payload 通过 `memoryAssertionSchema` 校验（round-trip）；
- summary 文档构建确定性；
- coverage 类型放宽后 v2 编译回归锚（hash 不变）。

### 16.2 Bootstrap / recorder 扩展测试

- watermark 读取与 MEMORY_SNAPSHOT put 的 enqueueWrite 串行性；
- snapshot put 失败 → manifest 字段回退且 run 不降级；
- visualObservationIds 从 turn 传入 manifest。

### 16.3 Server 单元测试

- `headSeq` 语义（空 branch → 0）；
- resolver：命中映射 + 制品存在 → resolved；无映射 → 空 Map；制品缺失 → 空 Map；多 ref 保序（Phase 3 既有断言复用）；
- 映射写入幂等（同 ref 二次资产化）；
- 媒体制品 sha256 = 文件字节哈希、sink key `.bin`。

### 16.4 Disposable PostgreSQL 集成测试

- fresh deploy Phase 0–5 migrations；
- 完整链路：inbound（含媒体 ref）→ run chain → extraction 产物 → memory_asserted/superseded 落库 + id 幂等重放；
- superseded 的 target/replacement 双向解析；
- v2 编译：resolved attachment 出现、`run_response_artifact_missing` 消失（制品已存）、coverage.memoryFacts=true；
- manifest：watermark 与 memory_events headSeq 一致、MEMORY_SNAPSHOT 可反序列化回 TapeState、visualObservationIds/summaryArtifactIds 填充；
- append-only：memory_events 拒绝 UPDATE/DELETE；
- `findLiveAssertionByKey` 经索引列查询返回 live 断言，同 key 值更新后返回新断言；
- `EXPLAIN` 确认该查询命中 `(account_id, branch, category, key, memory_seq)` 索引（防退化全表扫）；
- 映射唯一性：同 ref 二次资产化 no-op；
- 对账：无新增检查——媒体映射缺失表现为 compiler 侧 unresolved（已有类别），不进 reconciliation。

### 16.5 回归

Phase 0–4 全部测试与 typecheck、layer check、prisma validate/migrate deploy、Agent/Server/SDK 全量继续通过；Phase 4 的 v2 hash 回归锚不得变化。

## 17. 文件级实施顺序

1. `MemoryEventStore.headSeq` Port 扩展 + server 实现 + 单测；
2. memory fact-writer（事件构建 + 双写）+ extractor 接线 + 单测；
3. manifest 记忆字段：memory-bootstrap（watermark + snapshot）+ bootstrap 输入扩展 + 单测；
4. 媒体：sink key `.bin` 放宽 + MEDIA_ASSET put + 映射表 migration + resolver 真实实现 + server 接线 + 单测；
5. VISUAL_OBSERVATION pin + manifest.visualObservationIds + 单测；
6. SUMMARY 制品 + `memory_anchor_created` + tape_anchors 加列 + 单测；
7. coverage 放宽 + 回归锚测试；
8. disposable PostgreSQL 全链路集成测试。

每步保持 typecheck、layer check 与 Phase 0–4 回归通过。第 3 步完成前 memory 字段保持回退值；全部步骤完成前不观察生产指标。

## 18. Rollout

1. fresh disposable PostgreSQL 执行全部 migration 与集成测试；
2. 部署 expand-only Phase 5 migration（映射表 + tape_anchors 加列）；
3. 部署代码；`run_ledger_rollouts` 关闭时全部为死代码路径；
4. 验证 Phase 3/4 链路不受影响；
5. 内部账号（已启用 run ledger）自动获得 Phase 5 行为（同一开关）；
6. 观察：memory_event failed 率、media mapping failed 率、artifactPut failed 率、`canonical_unresolved_attachment` 对新增流量的下降、inline latency 增量；
7. 扩展到更多账号；
8. Phase 5 保持生产读取不变。

停止条件：

- memory/媒体写入失败率 > 1%；
- inline latency p95 增量 > 50ms（memory 读取新增）；
- superseded orphan_target 非零（证据链推导有 bug）；
- resolved attachment 的 mimeType/内容与原文件不符（内容寻址出错）；
- v2 hash 回归锚变化。

回滚：`run_ledger_rollouts` 关闭即回到 Phase 4 行为。已写入的 Memory Event、映射、制品全部保留（事实不删）；Tape/生产路径全程未被改动。

## 19. 验收标准

1. 启用 rollout 的账号，extraction 产物以 Memory Event 落库，幂等且证据链（source events + run + extraction revisions）完整可解析；
2. 同 key 值更新产生 superseded 且双向可解析；同值重放不产生新事件；
3. manifest.memoryEventWatermark / memoryArtifactId / summaryArtifactIds / visualObservationIds 有真实值且为 "as of compile time" 语义；
4. 新 ingress 媒体消息的 attachmentRefs 在 v2 编译中 resolved，制品内容寻址于文件字节；
5. compaction 产生 SUMMARY 制品与 memory_anchor_created 事件；
6. canonical entries、hash、memory input 语义与 Phase 4 逐字节一致（coverage 字段放宽除外）；
7. 全部新增写失败 fail-open；
8. Phase 0–4 全部回归通过。

## 20. 预计文件范围

### Agent

```text
M packages/agent/src/ports/memory-event-store.ts            # +headSeq
M packages/agent/src/context-compiler/types.ts              # coverage 放宽
A packages/agent/src/memory/fact-writer.ts
M packages/agent/src/memory/extractor.ts                    # canonical turn input + 双写接线
M packages/agent/src/memory/index.ts
A packages/agent/src/memory/summary-artifacts.ts
M packages/agent/src/memory/service.ts                      # compactIfNeeded 制品化 hook
M packages/agent/src/engine/run-ledger/memory-bootstrap.ts  # 新文件
M packages/agent/src/engine/run-ledger/bootstrap.ts         # 输入扩展
M packages/agent/src/engine/run-ledger/index.ts
M packages/agent/src/engine/turn.ts                         # visual observation pin、ledger 输入
M packages/agent/src/llm/vision.ts                          # （可选）observation 产出钩子
M packages/agent/src/index.ts
A packages/agent/test/memory/fact-writer.test.ts
A packages/agent/test/context-compiler/coverage.test.ts     # 或并入 compiler.test.ts
M packages/agent/test/context-compiler/compiler.test.ts
M packages/agent/test/engine-run-ledger/recorder.test.ts
```

### Server

```text
M packages/server/src/db/memory-event-store.impl.ts          # +headSeq
A packages/server/src/db/conversation-attachment-artifacts.ts
A packages/server/src/db/prisma-attachment-artifact-resolver.ts
M packages/server/src/agent.ts   # attachAssetIdToMedia 增加 sourceRef 参数、resolver 接线、媒体制品化
M packages/server/prisma/schema.prisma
A packages/server/prisma/migrations/20260830200000_add_ledger_coverage_phase_5/migration.sql
M packages/server/test-integration/run-ledger-phase-4.test.ts
A packages/server/test-integration/ledger-coverage-phase-5.test.ts
```

### Observability

```text
M packages/observability/src/metrics/agent-metrics.ts
M packages/observability/src/metrics/index.ts
M packages/observability/src/index.ts
```

## 21. Phase 6 入口

Phase 6 在 coverage 全开的基础上完成收敛与切换：

- 辅助 run 源接线：heartbeat/scheduler 的 trigger run（`runKind` 枚举已预留）、主动推送 outbound 事实——`legacy_only_assistant_entry` 收敛到零；
- 读取切换硬门禁：数据库不变量核查（无 `command_name='clear'` 而缺 boundary；无未终态异常 run；memory/media 映射自启用覆盖率报告）+ `unclassified_difference` 与 `legacy_only_*` 收敛报告；
- 生产读取切换：chat 上下文组装从旧 Message/Tape 切到 manifest 驱动的 canonical context（灰度按账号），旧路径保留为回退；
- 切换后：旧 `messages` 双写是否退役、Tape 是否转为纯投影、媒体/记忆的删除策略（隐私）独立设计。

在 Phase 5 的 memory/media/summary 制品与 Phase 4 的 run 链齐备之前，不允许启动切换评估。
