# ClawBot Agent 架构与系统设计评审（2026-07-02）

> 评审范围：`packages/agent`、`packages/server`、`packages/web`、Prisma schema、tape/工具/技能/MCP/心跳/调度器等核心代码。基于实际代码阅读（约 30 个关键文件），非目录名推断。

---

## A. 总体评价

这个项目**明显好于原型，属于"架构意图清晰、执行纪律较好的早期产品"**。Port/Adapter 是真实执行的——`packages/agent` 全源码 grep 不到任何 `prisma` 或 `hono` 引用，所有 IO 走 `ports/` 下 12 个接口注入；Tape 的 `fold(snapshot, entries)` reducer 实现干净（`tape/fold.ts` 是纯函数）；三级模型配置解析链（`model-resolver.ts:176-180`）与"LLM 配置只来自数据库"的约束执行一致（`ai.ts` 的 `getConfigDiagnostics` 明确 `llmConfigSource: "database"`，无 `LLM_*` 环境变量旁路）。

但它有一条**贯穿性的结构缺陷：大量模块级可变全局状态**（工具上下文槽、会话历史 Map、session 缓存、port 单例槽）。在"多账号并发"这个产品核心场景下，其中一处（工具上下文槽）已构成**可复现的跨账号数据污染竞态**；另有一处**认证中间件注册顺序错误，webhook 管理接口疑似无认证**。这两个属于必须立即修的正确性/安全问题。整体结论：**不需要系统性重构，需要一次针对并发正确性与安全边界的集中修复，加上对"单进程假设"的显式化**。

## B. 架构优点（值得保留）

1. **Port/Adapter 是真的，不是文档摆设**。`agent/src/ports/` 定义 MessageStore/TapeStore/SchedulerStore/PushService 等接口，`server/src/ai.ts` 统一注入 Prisma 实现，依赖方向经 grep 验证无违例。
2. **Tape 记忆的 reducer 模型实现清晰**。`fold.ts` 纯函数、last-write-wins 语义明确；`recall = anchor.snapshot + 增量 entries`（`tape/service.ts:32-63`）；anchor 带 `manifest`/`predecessors` 保留可追溯性；`/reset` 时的 handoff anchor（`filterForHandoff` 只带走高置信 facts + 全部 preferences + 最近 20 条 decisions）是很好的边界设计。
3. **Runner 把工具执行收拢在自己手里**（`runner.ts:263-277`，只给 AI SDK schema 不给 execute），统一埋点、超时（`AbortSignal.any([timeout, parent])`）、错误回灌为 error tool result——正确的控制反转方向。
4. **上下文窗口管理是主动的**：`fitToContextWindow` 每轮按 system prompt + tools schema 的 token 开销裁剪，带分级 trim 指标。
5. **微信凭据加密该有的都有**（`credentials/crypto.ts`：HMAC 派生 per-account key + AES-GCM + keyVersion）。
6. **可观测性一体化**：trace/span 贯穿 message.receive → command.dispatch → llm.call → tool.execute，span 内容过 `sanitize()` 脱敏；UsageEvent 全量计量与采样 trace 解耦。
7. **Web 前端边界干净**：`web/package.json` 只依赖 `@clawbot/shared` + `@clawbot/ui`；`lint:arbitrary` 脚本用 grep 硬性禁止 Tailwind 任意值——用工具而非公约执行规范。features 按页面域拆分，最大文件 489 行，hooks/api/router 分层清晰。
8. **Prisma schema 索引质量高**：messages 的 `[accountId, conversationId, seq]` 唯一约束、tape 三个 branch 复合索引、webhook 幂等键索引，高频路径基本都覆盖了。

## C. 主要问题

### Critical

#### C1. 工具上下文槽是模块级全局变量，多账号并发下跨账号污染

- **位置**：`packages/agent/src/runtime/agent-tool-context.ts:23-42`（`createToolContextSlot` 就是闭包里一个 `let current`）；`packages/server/src/agent.ts:303-304` 每次 chat 前 `setSchedulerContext({accountId, ...})` / `setHeartbeatToolContext(...)`，finally 清空。
- **为什么是问题**：`withConversationLock` 只按 `${accountId}::${conversationId}` 串行化（`history.ts:86-99`），**不同账号/会话的 chat 是并发的**。账号 A 的 LLM 循环执行到 `schedule` 工具时，账号 B 的请求进来覆盖 slot，A 的定时任务就建到 B 的账号下。多轮工具循环耗时数秒到数十秒，竞态窗口很大。更糟：`scheduler/executor.ts:55-58` 执行定时任务时调 `chat()` **根本不设置 context**，任务 prompt 若触发 schedule/heartbeat 工具，读到的是当时恰好在跑的某个用户聊天的 context。
- **影响范围**：多账号隔离承诺被打破；scheduler、heartbeat 两族工具。
- **建议改法**：把 `AgentToolContext` 放进 runner 已有的工具执行链路——`executeToolCall` 的 `deps` 已传 `signal/timeoutMs`，加 `ctx: {accountId, conversationId}` 一路传到 `tools.execute(name, args, ctx)`（扩展既有 `ToolExecuteContext`）。这同时消灭 executor 不设 context 的问题。最小改动备选：slot 内部换成 `AsyncLocalStorage`，server 侧改 `als.run(ctx, ...)` 包裹。
- **改造成本**：M。**风险**：低，纯管道改造。

#### C2. webhook 管理接口注册在 JWT 中间件之前——疑似无认证

- **位置**：`packages/server/src/api/index.ts:88` `registerWebhookRoutes(app)` 在第 92 行 `app.use("/api/*", jwt...)` **之前**；`webhooks/routes.ts:17-110` 的 `/tokens` 增删改查处理器内部没有任何认证检查，注释写"由上层 middleware 处理"。
- **为什么是问题**：Hono 严格按注册顺序执行，先注册的终端 handler 命中后不会再走后注册的中间件。即 `POST/GET/PATCH /api/webhooks/tokens` 很可能**完全绕过 JWT**。攻击链：未认证创建 webhook token → 用该 token 向任意账号任意会话投递消息并驱动 LLM + 工具调用。JWT 中间件专门豁免了 `POST /api/webhooks`，说明作者意图是保护其余路径——意图与实现不符。
- **建议改法**：把 `registerWebhookRoutes` 挪到 JWT 中间件之后（投递端点的豁免逻辑已存在）；加集成测试断言不带 JWT 访问 `/api/webhooks/tokens` 返回 401。**建议先 `curl -X GET http://localhost:8028/api/webhooks/tokens`（不带 Authorization）实测确认**——基于 Hono 语义判断为高置信，值得 5 分钟验证。
- **改造成本**：S。**风险**：无。

#### C3. CLI 工具 allowlist 含 `docker` 与 `curl`，等效于给 LLM 本机 root 与无限制 SSRF

- **位置**：`packages/agent/src/tools/handlers/cli.ts:5` `BINARY_ALLOWLIST = new Set(["opencli", "gh", "docker", "curl"])`，参数由模型生成。
- **为什么是问题**：输入来源是微信消息和 webhook——**不可信外部输入驱动模型**，prompt injection 即可让模型执行 `docker run -v /:/host ...`（等效 root）或 `curl http://169.254.169.254/`、`curl file:///...`（内网/元数据/本地文件外带）。讽刺的是 `web-tools/service.ts:346-377` 为 web_fetch 认真做了私网/localhost/保留地址防护，而 curl 把这层防护整个绕开。禁 shell 元字符（cli.ts:92）防的是命令拼接，防不了这两个二进制自身的能力。
- **建议改法**：默认名单收缩为 `opencli`（或空）；docker/curl 若确有场景，改为按账号显式授权 + 参数白名单（curl 强制复用 WebToolService 的地址校验）。`handlerConfig.binary` 由工具文件定义、模型不可覆盖这点已经做对，问题只在名单本身。
- **改造成本**：S。**风险**：可能砍掉在用技能，先 grep `data/tools/` 确认引用。

#### C4. LLM Provider API Key 明文入库，与其他密钥处理不一致

- **位置**：`schema.prisma:454` `ModelProviderTemplate.apiKey String?` 明文；对比同文件 `WebSearchProvider.apiKeyCiphertext`（加密）、`WeixinAccountCredential`（AES-GCM 三件套）。`AppSettings.assetS3SecretAccessKey`、`rsshubPassword` 同样明文。
- **为什么是问题**：DB 备份/dump 泄露即泄露平台价值最高的密钥。加密基础设施已存在（`credentials/crypto.ts`），不用它纯属遗漏。API 层已做对（`model-provider-templates.ts:24` 只返回 `api_key_set` 布尔），只差存储层。
- **建议改法**：复用 AES-GCM 方案加密这三处，写迁移脚本原地加密存量数据，`model-config-store.impl.ts:65` 读取处同步解密。
- **改造成本**：M（含迁移）。**风险**：中，迁移需可回滚。

#### C5. 用户 chat 全程无取消机制；scheduler 超时不终止运行

- **位置**：`chat.ts:374` `runner.run(history, tracker.callbacks, undefined, ...)` —— signal 永远 undefined；`scheduler/executor.ts:55-58` 用 `withTimeout(chat(...), 60_000)` 只让 Promise reject，**底层 run 继续跑**：继续调 LLM 烧 token、继续往共享 `history` 数组 push 消息、继续 `queuePersistMessage`。executor 调 chat 也没拿 conversation lock。
- **为什么是问题**：超时后的"僵尸 run"与后续对该会话的正常请求并发修改同一 in-memory history，既是资源泄漏也是数据竞态。runner 明明支持 signal（`runner.ts:430-432` 每轮检查、工具侧有 `AbortSignal.any`），管道断在 chat() 这一层。
- **建议改法**：`chat()` 增加 `signal?: AbortSignal` 透传给 `runner.run`；executor 改用 `AbortController` + 超时即 abort，并包上 `withConversationLock`。
- **改造成本**：S。**风险**：低。

### High

#### H1. 消息持久化是 fire-and-forget 全局单队列，可丢、可堵、双写不一致

- **位置**：`server/src/db/messages.ts:34-36`（模块级 `queue` 数组）、`queuePersistMessage`（`void (async ...)` 火忘）、`flushQueue:309-340`（队头失败指数退避并**阻塞整个队列**）、`persistRecord` 遇 seq 冲突**直接丢弃记录**（日志原文："Duplicate seq — likely stale in-memory history after restart"）。
- **为什么是问题**：(1) 内存 history 是事实源、DB 是尽力而为——crash 丢未 flush 消息，重启后 `restoreHistory` 与用户实际看到的对话不一致；(2) 全局单队列 head-of-line blocking：一条坏记录以 backoff 卡住**所有账号所有会话**的持久化；(3) seq 在内存分配（`nextSeq`），冲突时静默丢数据——违反项目自己"禁止静默吞异常"的规范（有 log，但数据没了）。
- **建议改法**：短期按 conversation 分队列 + 最大重试次数 + 死信落盘；中期 seq 分配下沉 DB，in-memory 只做缓存。
- **改造成本**：M。**风险**：中，核心写路径，需演练重启/断库场景。

#### H2. 工具/技能/MCP 没有账号级权限模型，也没有审计

- **位置**：`ai.ts:120-135` —— `toolRegistry` 是进程级 composite，所有账号共享全部工具（local + MCP + scheduler + heartbeat + skill runtime）；`McpTool.enabled` 是全局开关。
- **为什么是问题**：这是"多账号平台"，但一个账号接入某内部系统的 MCP server 后，**所有账号的所有微信联系人**都能通过 prompt injection 调它。版本化、灰度、禁用、审计、权限——目前只有全局禁用；trace 有记录但没有审计语义。
- **建议改法**：加 `account_tool_permissions` 表（或 account config 里存 allowlist），runner 组装 `currentTools` 时按账号过滤——C1 修复后 runner 就有 accountId 可用。审计先从 `tool.execute` span 加 accountId 维度 + 独立保留策略做起。
- **改造成本**：M。**风险**：低。

#### H3. 隐藏全局状态遍布 agent 包，测试覆盖与风险严重错配

- **位置**：`conversation/history.ts:15-21`（5 个模块级 Map/数组）、`server/agent.ts:115` sessionCache、`model-resolver.ts:67` cache、`chat.ts:78` `_deps`、`ports/slot.ts` 全部 port 单例、`heartbeat/engine.ts:20-26`。测试现状：全仓 26 个 test 文件对 501 个 ts 文件，且 **runner.ts、chat.ts、history.ts、composite-registry.ts、tape/service.ts 全部零测试**（有测试的是 json/extractor/evaluator/settings 等外围）。
- **为什么是问题**：最复杂、并发最敏感的代码恰好不可测——全局单例导致测试间状态泄漏，无法构造两个隔离实例。C1 正是这种结构的必然产物。
- **建议改法**：不要求全面 DI 化。务实路径：给 history 和 slot 加 `resetForTest()`，先给 runner 工具循环、`withConversationLock`、`rollbackMessages`、composite 冲突合并补单测（都能用假 port 跑）；新代码一律参数传递，不再新增全局。
- **改造成本**：M（持续）。**风险**：无。

#### H4. Tape 状态无界增长 + 全量注入 prompt，会形成上下文膨胀

- **位置**：`fold.ts:74-83`（decision 永远 append）、`service.ts:84-104`（checkpoint compact 的 snapshot 是全量状态，decisions 只在 handoff 时裁到 20）、`service.ts:190-229` `formatMemoryForPrompt` 把 **global + session 的全部 facts 和 preferences** 每轮注入。
- **为什么是问题**：长期运行的账号，GLOBAL_BRANCH 的 facts/preferences 只增不减，decisions 在 checkpoint snapshot 里无限累积。半年后每条微信消息都背着几千 token 的 `<memory>` 块；extractor 的 `formatExistingKeys` 也把全量 key 注入抽取 prompt——两头膨胀。
- **建议改法**：(1) checkpoint compact 应用与 handoff 相同的 decisions 裁剪；(2) `formatMemoryForPrompt` 加 token 预算（facts 按 updatedAt 截断）；(3) facts 加数量上限或过期策略。
- **改造成本**：S-M。**风险**：低。

#### H5. `server/agent.ts` 的 createAgent 职责过载

- **位置**：`server/src/agent.ts:232-393`，一个 chat 方法里塞了：contextToken 持久化、定时任务补发、session 路由、命令分发、context slot 注入、asset ingest、加锁调 chat、标题生成、心跳后置检查、trace 落库。
- **为什么是问题**：这是微信运行时和 agent 引擎之间唯一的桥，每加一个"消息前后钩子"都往这里堆，已经出现 C1 那种"在错误的层设置全局状态"的症状。
- **建议改法**：拆成 pre-chat hooks（contextToken/补发/路由）、dispatchCommand、runChat、post-chat hooks（标题/心跳/trace）四个函数，chat 方法只做编排。不引入框架。
- **改造成本**：S。**风险**：低。

### Medium

- **M1. 单进程假设未显式化**：in-memory history 锁、seq 计数、sessionCache、scheduler 全部假设单实例。现在可接受，但应写进 `docs/agent-architecture.md`，避免有人起两个实例（会双倍回复 + seq 冲突丢数据）。成本 S。
- **M2. 类型谎言**：`tape/service.ts:99-102` `entryEids as unknown as bigint[]`，注释承认"让 store 实现在边界处理转换"——把 port 的 `compactTransaction` 第二参改成 `string[]`（eid），转换责任归 impl。成本 S。
- **M3. 日志体系分裂**：agent 包 30 处 `console.warn/log/error`，server 用结构化 pino。observability 已有 `createLogger`（heartbeat 在用），agent 包统一换掉，否则生产日志一半没有结构化字段。成本 S。
- **M4. runner 每轮重复构建**：`buildAiSdkTools(currentTools)` 在循环内每轮重建（`runner.ts:457`），注释明确说 tools 一次 run 内不变——提到循环外。`composite-registry.execute` 的 `findToolOwner` 每次线性扫全部 registry 快照，MCP 工具多后是每次调用 O(N)。成本 S。
- **M5. `Message` 与 `Conversation` 无外键**（Message 只关联 Account），`messageCount/lastMessageAt` 靠应用层维护，可能漂移。可接受，列表统计不准先查这里。成本 S。
- **M6. `AppSettings` 是上帝表**：RSS、S3、限流配置混在单行宽表。下个子系统配置进来前改成 kv（`settings(key, value_json)`）或按域拆分。成本 M。
- **M7. 定时任务 60s 硬超时不可配**（`executor.ts:13`）：多轮 LLM + 工具循环轻松超 60s；`ScheduledTask.configJson` 已有存放处，做成 per-task 配置。成本 S。

### Low

- `resolveEffectiveModel`（runner.ts:224-227）用 `(model as Record<string, unknown>).modelId` 摸 AI SDK 内部结构；`ResolvedModel` 本来就有 `modelId`，override 路径一起传进来即可。
- `db/messages.ts` 写入时给 payload 注入 display path（`addDisplayPathsToPayload`）——存储层揉进展示关注点，读取时计算更干净。
- `skills/runtime-tools.ts` 的 `splitArgs` 与 `cli.ts` 的 `splitCommand` 是几乎相同的手写 argv 切分，抽到 utils 去重。
- `sanitizeEnv`（runtime-tools.ts:83-95）是前缀黑名单，自定义命名的密钥会漏——技能脚本执行环境建议改白名单（PATH/HOME/LANG + 显式声明）。
- `components/` 下的 `ConversationList/MessageBubble` 属 Conversation 域，放 `features/Conversation` 更一致。web 其余部分健康。

## D. 推荐改造路线图

### 阶段 1：立即修复（1-3 天）—— 并发正确性与安全止血

| 任务 | 对应 | 成本 |
|---|---|---|
| webhook 路由挪到 JWT 中间件之后 + 401 测试 | C2 | 半天 |
| 工具上下文改为随 run 传递（或 ALS 兜底） | C1 | 1 天 |
| `chat()` 透传 AbortSignal；executor 超时改 abort + 加会话锁 | C5 | 半天 |
| CLI allowlist 移除 docker/curl | C3 | 半小时 |

**收益**：消除已知的跨账号污染、未授权入口、僵尸 run。**风险**：极低，全部有明确验证手段（两账号并发建定时任务压测、curl 打管理接口）。

### 阶段 2：短期改造（1-2 周）—— 数据可靠性与权限边界

1. API key 加密迁移（C4，含 AppSettings 密钥列）。
2. 消息持久化按会话分队列 + 死信 + 重试上限（H1）。
3. Tape prompt 注入预算 + checkpoint decisions 裁剪（H4）。
4. `account_tool_permissions` 账号级工具过滤（H2 第一步）。
5. runner/history/composite-registry 补单测；agent 包 console → logger port（H3/M3）。

**收益**：DB dump 不再等于密钥泄露；消息不再全局连坐；长期账号 token 成本可控；多账号工具隔离成立。**风险**：H1 动核心写路径，测试环境演练重启/断库。

### 阶段 3：中期重构（1-2 个月）—— 结构性去全局化

1. 拆 `server/agent.ts`（H5），沉淀 pre/post-chat hook 链。
2. `history.ts` 五个全局 Map 收进 `ConversationCache` 实例由 server 注入（不改 port 协议，只消灭模块级状态）；同法处理 sessionCache。
3. seq 分配下沉 DB，为多实例留口（不做多实例本身）。
4. 工具调用审计视图（基于既有 trace_spans + 保留策略 + 查询 API）。
5. 单进程约束、启动顺序、port 注入图写入 `docs/agent-architecture.md`。

**收益**：核心引擎可实例化、可测试，为新工具族/新记忆策略扫清结构障碍。**风险**：步骤 2 触面广，按模块渐进，每步保持 `pnpm test:agent` 绿。

## E. 目标架构建议

包边界维持现状（划分是对的），调整发生在模块内部。

**包边界**：`server → agent → observability → shared`、`web → ui/shared` 不变；`weixin-agent-sdk` 保持独立协议层，只暴露 `Agent` 接口给 server——现状即目标。

**模块边界（agent 包内）**：
- `engine/`（现 runner + chat + conversation）：一次 run 是一个携带 `RunContext { accountId, conversationId, signal, logger }` 的执行体，所有工具/技能/记忆通过 ctx 取上下文，**零模块级可变状态**。
- `capabilities/`（tools + skills + mcp adapter + scheduler tool + heartbeat tool）：统一经 composite registry 暴露，registry 查询接受 accountId 做权限过滤。
- `memory/`（tape）：结构保留，只加预算层。
- `ports/`：接口不变，slot 实现允许实例化。

**数据流**：微信/webhook 入站 → `server/agent.ts`（薄编排：路由、命令、hooks）→ `withConversationLock` → `chat(ctx)` → runner 多轮循环 → MessageStore 按会话队列落库（**DB 为最终事实源，内存为缓存**——与现状相反）。

**配置流**：Web 后台写 `model_configs`/`model_provider_templates`（key 加密存储）→ 写后 `invalidateModelCache` → `resolveModel` 按 conversation → account → global 首中即用（现状保留）→ 禁止 env 旁路（已达成，文档固化）。

**Agent 执行流**：resolve model → 并行 load history + recall(session/global)（现状）→ 组装 user context（memory 按预算截断）→ 逐轮：assemble system prompt（含 on-demand skills）→ trim → LLM → 并行工具执行（每个工具拿 `ctx + AbortSignal.any([timeout, run signal])`）→ 终止条件不变。

**工具调用流**：LLM tool-call → composite registry 按 (accountId, toolName) 定位 owner 并校验权限 → handler 执行 → span 记录（含 accountId）→ error 回灌模型。`use_skill` 保持 runner 内建特例（按既有决策不做 registry 化）。

**记忆写入/读取流**：回复送达后 fire-and-forget extractor（现状）→ `queueRecordEntry` 落 tape_entries → 阈值触发 compact 产 checkpoint anchor（**加 decisions 裁剪**）→ recall = 最新 anchor + 增量 fold → 注入按 token 预算截断。`/reset` 走 handoff anchor 链（现状保留）。

## F. 不建议做的事情

1. **不要为多实例/水平扩展重构**（分布式锁、Redis 会话、消息队列）。自托管微信 bot 单进程完全够，把假设写清楚比消除假设便宜两个数量级。只做"seq 下沉 DB"这一个留口。
2. **不要给工具/技能做版本化与灰度系统**。用户是管理员自己，"enabled 开关 + git 管 markdown"已覆盖需求；灰度是有海量终端用户时的问题。
3. **不要把 Tape 换成向量数据库/RAG**。当前 facts/preferences 是结构化 KV，last-write-wins 可调试、`sourceEid` 可追溯——embedding 检索会摧毁这个最有价值的性质。先做预算截断，真出现"记忆多到查不准"再议。
4. **不要引入 DI 容器或全面重写 port 注入**。setter 注入土但直白，问题只在"槽是全局的"，让槽可实例化即可，别上框架。
5. **不要按已否决方向重做**：Strategy 映射表替换 switch、ConversationRef 参数对象、`use_skill` 收进工具 registry——此前已评估过收益不抵成本，本次维持该结论。
6. **不要拆微服务**。server/agent 的进程内边界已经足够清晰（ports 接口即证明），拆进程只会把 C1 这类竞态换成分布式一致性问题。

---

**信息不足之处**（需要继续查看的文件）：

1. C2 的 Hono 路由顺序结论建议 curl 实测一次收尾。
2. 未深入 `weixin-agent-sdk` 协议实现——allowFrom 白名单的执行点在 `auth/pairing.ts`/`login-qr.ts`，未确认入站消息是否**逐条**校验发送者（若只在配对时校验，群聊发言人过滤值得单独检查）。
3. heartbeat evaluator 的 LLM 评估成本模型未细看（PendingGoal 已有 token 统计字段，说明已在关注）。

**最优先的行动**：先修 C1 和 C2——这两个是"现在就错"，不是"将来会拖慢"。

---

## 附：阶段 1 实施决策记录（2026-07-02 确认）

### 决策 1：C1 采用 ToolContext 参数传递，不用 AsyncLocalStorage

**结论**：把 `accountId/conversationId` 放进 ToolContext，由 runner 经 `executeToolCall` 的 `deps` 传给 `tools.execute(name, args, ctx)`。

**理由**：
- ALS 只是把"隐式全局"换成"隐式请求局部"，工具获取上下文的路径仍然不可见，测试仍需 `als.run` 包裹，与阶段 3 去全局化方向相悖。
- runner 的 `executeToolCall` 已在传 `deps { signal, timeoutMs }`，加字段是顺路改动，调用链在自己手里，不存在"改不动"的问题——那是 ALS 唯一值得用的场景。

### 决策 2：scheduled run 中创建的新任务归属原始目标会话 `task.conversationId`

**结论**：定时任务执行期间，LLM 若调用 `create_scheduled_task`，新任务的 conversationId 继承 `task.conversationId`（原始目标会话），**不是**内部执行会话 `scheduler:{seq}`。

**理由**：
- `scheduler:{seq}` 是纯内部执行会话——没有微信路由、没有 contextToken，`sendProactiveMessage` 对它必然失败，归属它的新任务会变成"永远推送不出去的孤儿"。
- 现有代码的一个有意设计支持此选择：`server/agent.ts:303` 给 scheduler context 传的是 `req.conversationId`（微信原始会话 ID）而非 `effectiveConvId`（心跳传的是后者）。推送目标用原始 ID 才能在 `/reset` 会话轮换后依然送达。新任务继承 `task.conversationId` 延续该语义，实现时保持这个不对称，不要"顺手统一"成 effectiveConvId。

### 决策 2 对 C1 接口的约束（实现前必读）

scheduled run 中存在两个不同的会话身份：

| 身份 | 值 | 用途 |
|---|---|---|
| 执行会话 | `scheduler:{seq}` | chat() 的 history / memory / trace |
| 工具可见会话 | `task.conversationId` | scheduler/heartbeat 工具的归属与推送目标 |

**因此 ToolContext 不能简单地从 `chat()` 入参派生**——否则工具拿到 `scheduler:{seq}`，决策 2 落空。ToolContext 必须允许调用方覆盖：

- `scheduler/executor.ts` 显式传 `{ accountId: task.accountId, conversationId: task.conversationId }`；
- 普通用户聊天路径两者一致，直接用 chat 入参派生。

这一条与 C1 同时实现，接口一次改对，避免返工。
