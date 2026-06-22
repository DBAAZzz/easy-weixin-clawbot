# @clawbot/agent 技术架构交叉 CR

> 评审对象：`packages/agent/`
> 交叉验证对象：`docs/agent-package-architecture-review.md`
> 评审日期：2026-06-20
> 最后修订：2026-06-20（核实 server 调用方后翻案"会话锁"P1）

## 总体结论

`@clawbot/agent` 的架构方向是正确的：Port/Adapter 边界清晰，LLM 适配层基本收敛，Tape 记忆、context window 裁剪、MCP stdio client 等子系统有较好的工程完整度。

**本次交叉 CR 最重要的修正**：第一份 `agent-package-architecture-review.md` 把"`chat()` 缺少会话锁、存在并发写历史竞态"列为头号 P1，本份初稿也沿用了这个判断。但在核实 server 侧调用方后，**该 P1 不成立**——会话锁在 server 适配层已被一致施加，且是 agent 包显式表达的 Port 契约（详见下文）。两份评审此前共享了同一个盲点：都只看了 agent 包内部，没读 caller。

更正后，这个包没有**当前可触发的并发正确性缺陷**。真正的技术债集中在两点：**可测试性（进程级全局状态难以隔离）** 与 **`chat.ts` / `runner.ts` 两个核心编排文件职责过重**。

我的评级维持 **B+**：护城河仍是边界设计；但"会话并发安全"不应再算欠债。

## 关键发现

### ✅ 翻案（原 P1 → P3）：`chat()` 会话锁并非缺失，而是按设计放在调用方

第一份评审与本份初稿都判断"`chat()` 没有 `withConversationLock`，存在并发写历史竞态"。核实 server 侧四个调用点后，**这个不变量实际是被一致保证的**：

| 调用点 | 是否加锁 | 证据 |
|--------|---------|------|
| 主聊天入口 | ✅ 已加锁 | `server/src/agent.ts:311` `withConversationLock(accountId, effectiveConvId, () => chat(...))`，外层还套了 `conversation.lock` span |
| Heartbeat Phase2 | ✅ 已加锁 | `server/src/db/heartbeat-executor.impl.ts:20` 包裹 chat |
| RSS 摘要 | ⚠️ 未加锁，但天然安全 | `rss/task-service.ts:141` 每次用唯一 convId `rss-digest:{id}:{Date.now()}`，不存在同会话竞争 |
| 主动推送 | ✅ 间接加锁 | 走 `appendAssistantTextMessage`，函数内部自带锁 |

更关键的是，这个不变量**在 agent 包里是被显式表达的**，并非"隐性契约"：

- `ports/heartbeat-executor.ts:16` 注释明写 `Implementation MUST wrap with withConversationLock()`；
- `withConversationLock` 作为 public API 从包里导出，**就是为了让调用方包裹**。

而且把锁塞进 `chat()` 内部反而是**错误分层**——heartbeat 路径需要锁覆盖 `setHeartbeatContext()` + `chat()` 这一整段（比 chat 本身更宽的临界区）。当前"锁在调用方"是正确选择，不是 bug。

**重新定级为 P3 加固项**：真实问题只剩"该不变量靠调用点约定保证，没有类型/lint 强制"。新调用方可能遗漏（RSS 仅因用唯一 convId 才碰巧安全）。建议动作从"用锁包住 chat 主链路"改为：在 `chat()` 签名文档里声明调用方串行化契约，或提供一个 `chatLocked()` 薄封装，避免未来新增调用点漏锁。

### P2（原 P1，降级）: 模块级可变状态是最大结构性债务

> 降级说明：此项真实存在，但影响的是**可测试性 / 多实例隔离**，并非线上正确性——单进程下运行无误。头号 P1（会话锁）翻案后，不应为了"维持一个 P1"而高估本项的紧迫度。它是重要的中期重构方向，但不阻断当前功能。


典型状态包括：

- `conversation/history.ts`: `store`, `seqCounters`, `loading`, `waitQueues`
- `chat.ts`: `_deps`
- `ports/*`: 各类 `setXxx/getXxx` 单例
- `model-resolver.ts`: model config cache
- `tape/queue.ts`: fire-and-forget queue
- `scheduler/manager.ts` / `heartbeat/engine.ts`: timer、inflight、active jobs、account queue

这些状态让单进程内多实例 agent、测试隔离、热重载、局部 reset 都变得困难。短期可以补测试 reset hook；中期更合理的是引入 `AgentContext`，把 ports、cache、history store、queue、scheduler/heartbeat runtime 都挂到实例上。

### P2: `runner.ts` 职责过载

`runner.ts` 的 `run()` 同时承担：

- 选择有效模型与模型 metadata
- 组装 system prompt 和 skill runtime
- 合并工具 schema 并估算 token
- 处理 DeepSeek 历史兼容逻辑
- context window 裁剪与 metrics
- 构造 AI SDK tools
- 调用 `generateText`
- 将 AI SDK content parts 转成内部 `AssistantMessage`
- 并发执行工具并回灌 tool result

其中 AI SDK content part 转换现在内联在循环里，并使用多处 `as any`。这部分应移动到 `llm/messages.ts`，形成类似 `modelResultToAssistantMessage()` 的函数并独立测试。runner 只应该编排步骤，不应该长期持有 SDK part 解析细节。

### P2: provider-specific workaround 泄漏进通用循环

`runner.ts` 里通过 `isDeepSeekModel()` 判断是否执行 `stripUnreasonedToolCallHistory()`。这个兼容逻辑本身合理，但位置不理想。随着 provider 增加，runner 容易堆出更多 `if provider === xxx`。

建议把这类差异变成 `ModelMeta` capability / quirk，例如 `requiresReasonedToolHistory` 或 `historyPreprocessor`，由 LLM 层或 model metadata 层负责声明，runner 只消费能力。

### P2: `chat.ts` 混入媒体 IO 与 vision fallback 细节

`chat.ts` 直接 `readFileSync(media.filePath)`，并在主编排里处理 mime 探测、base64 转换、chat 模型是否支持图片、vision 模型解析、fallback placeholder、visual context 格式化。

这和 `agent` 包“纯编排层”的定位有张力。文件 IO 在 loader/installer/runtime tool 里是子系统职责，但在 `chat()` 主链路里直接同步读图片，会让编排层越来越厚。

建议抽出 `prepareUserMediaContent()` 或 `prepareVisualInput()` 到 `vision.ts` / `media.ts`。更进一步，可以通过 media/asset port 传入已解析的 bytes 或 asset reference，让 `chat()` 不直接碰文件系统。

### P3: 公共导出面偏宽

`packages/agent/package.json` 显式导出了根入口之外的多个内部子路径：`chat`、`media`、`conversation`、`tape`、`model-resolver`、MCP、registry、ports 等。`src/index.ts` 也几乎把所有子系统都 re-export 出去。

作为 monorepo 内部包，这不是立刻阻断的问题；但它会让外部包更容易依赖内部实现，后续重构成本会升高。建议区分 public API 与 internal API，至少在文档和 exports 命名上表达边界。

## 对现有评审文档的交叉验证

### 已验证成立

现有 `agent-package-architecture-review.md` 的这些判断与源码一致：

- Port/Adapter 边界总体严格，未发现 `agent` 导入 `server`、Prisma、Hono。
- 模块级可变单例状态广泛存在。
- `runner.ts` / `chat.ts` 两个核心编排文件职责偏重。
- DeepSeek 兼容逻辑泄漏到 runner。
- 日志仍大量使用裸 `console.log/warn/error`。
- 魔法常量分散。
- AI SDK 边界存在 `as any` 和强制断言。
- `index.ts` 与 package exports 导出面偏宽。

### 已推翻

- **"`chat()` 缺少同会话锁，是实质并发风险"——不成立**。会话锁在 server 适配层一致施加，且是 agent 包显式表达的 Port 契约（见上文"翻案"小节）。两份评审此前都只看了 agent 包内部、未核实 caller，共享了同一盲点。这也是本次交叉 CR 的核心价值：两份独立评审得出同一结论 ≠ 结论正确——当它们共享同一观察视野时，会一起踩同一个坑。

### 需要补充

现有文档没有突出 `chat.ts` 直接同步读取媒体文件这一点。它不是单纯代码风格问题，而是“纯编排层”边界的侵蚀：主聊天链路开始承担 asset/media adapter 职责。

### 需要校准

LLM 配置来源方面，源码显示主路径确实通过 `ModelConfigStore` 注入的数据库配置；`provider-factory.ts` 当前没有 API key 或 base URL 的环境变量回退。测试中也明确覆盖了 `does not read OPENAI_BASE_URL env var fallback` 和 `does not read OPENAI_API_KEY env var fallback`。

因此，现有文档关于“LLM 配置主路径来自 DB”的判断成立；不应把 `process.env` 命中简单归类为 LLM 配置回退。当前 `process.env` 主要出现在测试、MCP 子进程环境透传、skill runtime 环境清洗等场景。

### 可降低优先级

`composite-registry.ts` 每轮全量 merge snapshot、执行时线性查找 owner，目前更像小规模性能观察，不应和会话锁、全局状态、runner 过载放在同一风险层级。除非工具数量明显增长，否则可以后置。

## 优先级建议（交叉 CR 修正后）

| 优先级 | 问题 | 建议动作 | 相对初稿 |
| --- | --- | --- | --- |
| P2 | 全局状态过多 | 短期补 reset hook；中期引入 `AgentContext` | ⬇ 原 P1 降级 |
| P2 | `runner.ts` 过载 | 抽 `AI SDK result -> AssistantMessage` 到 `llm/messages.ts` | 维持 |
| P2 | provider quirks 泄漏 | 用 `ModelMeta` capability / quirk 替代 provider 判断 | 维持 |
| P2 | `chat.ts` 媒体处理内联 | 抽 `prepareUserMediaContent`，减少主链路 IO | 维持 |
| P3 | `chat()` 会话锁靠约定保证 | 文档声明串行化契约，或提供 `chatLocked()` 薄封装防漏锁 | ⬇⬇ 原 P1 翻案 |
| P3 | 导出面过宽 | 区分 public/internal exports | 维持 |
| P3 | 日志与常量治理 | 统一 logger，集中配置默认值 | 维持 |

> 修正后已无 P1。结论：该包无当前可触发的并发正确性缺陷；技术债以**可测试性**和**核心编排文件内聚度**为主。

## 验证

已运行：

```bash
pnpm -F @clawbot/agent test
```

结果：`58 pass / 0 fail`。

