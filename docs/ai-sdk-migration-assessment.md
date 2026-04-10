# AI SDK 迁移评估：从 @mariozechner/pi-ai 到 Vercel AI SDK

> **文档状态**：第一阶段只读审查  
> **审查日期**：2026-04-10  
> **pi-ai 版本**：0.62.0  
> **目标 SDK**：Vercel AI SDK (`ai` npm package)

> ✅ **Top-1 已决策（2026-04-10）**  
> **DB payload 策略采用“读旧写新”，不做一次性全量 migration。**  
> - 读取历史：保留旧 payload 读取适配器（兼容 pi-ai 历史格式）  
> - 新写入：统一写新格式（AI SDK/AgentMessage 目标格式）  
> - 不执行：一次性批量改库迁移（避免高风险数据操作）

---

## 1. 现状盘点：pi-ai 使用点清单

### 1.1 依赖声明

| 文件 | 行号 | 版本 |
|------|------|------|
| `packages/agent/package.json` | L93 | `"@mariozechner/pi-ai": "^0.62.0"` |
| `packages/server/package.json` | L15 | `"@mariozechner/pi-ai": "^0.62.0"` (type-only) |

> ⚠️ 纠正注记（2026-04-10）：
> - `packages/server/package.json` 中该依赖实际在 **L23**。  
> - “type-only”判断本身是成立的：`packages/server/src/ai.ts` 与 `packages/server/src/db/messages.ts` 都是 `import type`。  
> - 正确补充是：虽然是 type-only import，但它约束了消息 payload 的结构边界，迁移时仍需纳入兼容设计。
> - 原表保留作为“早期判断”，后续执行请以最新行号为准。

### 1.2 函数调用点（runtime 行为影响）

| 函数 | 文件 | 行号 | 用途 | 调用方式 |
|------|------|------|------|----------|
| `complete()` | `packages/agent/src/runner.ts` | L261-275 | **核心 LLM 编排循环** — 多轮 tool-use agent loop | `await complete(effectiveModel, { systemPrompt, messages, tools }, { apiKey, signal })` |
| `complete()` | `packages/agent/src/tape/extractor.ts` | L68-80 | **记忆提取** — 单轮无工具 LLM 调用 | `await complete(model, { systemPrompt, messages, tools: [] }, { apiKey })` |
| `complete()` | `packages/agent/src/heartbeat/reason-internal.ts` | L67-78 | **心跳推理** — 单轮无工具 LLM 评估 | `await complete(model.model, { systemPrompt, messages, tools: [] }, { apiKey })` |
| `getModel()` | `packages/agent/src/model-resolver.ts` | L108 | **模型注册表查询** — 从 provider+modelId 获取 Model 对象 | `(getModel as any)(provider, modelId)` |
| `Type.*` | `packages/agent/src/runner.ts` | L82-88 | **工具参数 schema** — `USE_SKILL_TOOL` 参数定义 | `Type.Object({ skill_name: Type.String(...) })` |
| `Type.*` | `packages/agent/src/heartbeat/tool.ts` | L38-50 | **工具参数 schema** — 心跳目标工具参数 | `Type.Object({ description: Type.String(...), ... })` |
| `Type.*` | `packages/agent/src/scheduler/tool.ts` | L62-71 | **工具参数 schema** — 定时任务工具参数 | `Type.Object({ name: Type.String(...), ... })` |
| `Type.*` | `packages/agent/src/tools/compiler.ts` | L1 | **Markdown 工具编译** — 动态构建 TypeBox schema | `Type.Object(...)`, `Type.String()`, `Type.Integer()`, etc. |

> ⚠️ 纠正注记（2026-04-10）：
> - 部分行号存在漂移，建议通过 `rg + nl -ba` 动态校准，不要硬编码。  
> - 当前仓库核对到的关键行号：  
>   - `packages/agent/src/runner.ts` `complete()` 调用在 **L248**  
>   - `packages/agent/src/heartbeat/reason-internal.ts` `complete()` 调用在 **L62**  
>   - `packages/agent/src/heartbeat/tool.ts` 的 `Type.Object(...)` 主要在 **L55+**  
> - 原表保留用于审查脉络；实施阶段请先做一次行号重扫。

### 1.3 类型引用点（type-only imports）

| 类型 | 文件 | 行号 | 用途 |
|------|------|------|------|
| `Message`, `AssistantMessage`, `TextContent`, `ImageContent`, `ToolResultMessage` | `packages/agent/src/chat.ts` | L8-14 | 消息内容提取与响应构造 |
| `AssistantMessage`, `ImageContent`, `Message`, `Model`, `Tool`, `ToolCall`, `ToolResultMessage` | `packages/agent/src/runner.ts` | L2-10 | Agent loop 消息处理 |
| `Model` | `packages/agent/src/model-resolver.ts` | L11 | ResolvedModel 类型定义 |
| `Model` | `packages/server/src/ai.ts` | L32 | 启动时 model 对象类型标注 |
| `Message`, `ImageContent`, `TextContent` | `packages/server/src/db/messages.ts` | L5 | 消息编解码相关类型约束（type-only import） |
| `Message` | `packages/agent/src/conversation/history.ts` | L7 | 会话历史存储 (`Message[]`) |
| `Message`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `TextContent` | `packages/agent/src/conversation/context-window.ts` | L13-18 | Context window 裁剪 |
| `Message`, `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `TextContent`, `ImageContent`, `ThinkingContent`, `ToolCall` | `packages/agent/src/conversation/token-estimator.ts` | L8-16 | Token 估算 |
| `Message` | `packages/agent/src/ports/message-store.ts` | L7 | 消息持久化端口接口 |
| `Message`, `ToolResultMessage` | `packages/agent/src/runtime/skill-runtime.ts` | L1 | 技能加载状态追踪 |
| `TSchema` | `packages/agent/src/mcp/tool-adapter.ts` | L1 | MCP 工具 schema 类型桥接 |
| `ImageContent`, `TextContent`, `Tool`, `TSchema` | `packages/agent/src/tools/types.ts` | L1 | 工具系统核心类型 |

### 1.4 影响面分析

| 层级 | 受影响文件数 | 严重程度 | 说明 |
|------|-------------|----------|------|
| **LLM 调用** (`complete()`) | 3 | 🔴 高 | 核心运行时，任何签名变化直接影响聊天、记忆、心跳 |
| **模型注册 (`getModel()`)** | 1 | 🔴 高 | model-resolver 是 multi-provider 的入口 |
| **Schema 构建 (`Type.*`)** | 4 | 🟡 中 | TypeBox re-export，AI SDK 使用 zod 替代 |
| **消息类型** | 10 | 🟡 中 | 全局类型替换，但结构相似 |
| **packages/web** | 0 | 🟢 无 | Web 层不直接依赖 pi-ai |
| **packages/shared** | 0 (注释) | 🟢 无 | 仅 `types.ts` L1 注释提及，无代码依赖 |

> ⚠️ 纠正注记（2026-04-10）：
> - “消息类型受影响文件数 = 10”是低估，至少还包含 `packages/server/src/db/messages.ts`。  
> - 实施前建议用脚本重新统计：`rg -n '@mariozechner/pi-ai' packages/{agent,server,web,shared}`。

---

## 2. 能力映射：pi-ai → AI SDK 对照表

### 2.1 核心函数

| pi-ai | AI SDK | 备注 |
|-------|--------|------|
| `complete(model, context, options)` → `Promise<AssistantMessage>` | `generateText({ model, system, messages, tools, ...options })` → `Promise<GenerateTextResult>` | 签名差异大：pi-ai 位置参数 → AI SDK 命名参数对象 |
| `stream(model, context, options)` → `EventStream` | `streamText({ model, system, messages, tools })` → `StreamTextResult` | 当前项目未使用 streaming，但迁移后可原生获得 |
| `getModel(provider, modelId)` → `Model` | `createOpenAI(...)('model-id')` / `createAnthropic(...)('model-id')` | AI SDK 每个 provider 独立包；无全局 model registry |
| `Type.Object()` / `Type.String()` ... (TypeBox) | `z.object()` / `z.string()` ... (Zod) | AI SDK 使用 Zod schema，非 TypeBox；需全面替换 |

### 2.2 类型映射

| pi-ai 类型 | AI SDK 等价 | 差异说明 |
|-----------|------------|----------|
| `Message` (union: User/Assistant/ToolResult) | `CoreMessage` (union: CoreUserMessage/CoreAssistantMessage/CoreToolMessage) | role 值不同：pi-ai `"toolResult"` → AI SDK `"tool"` |
| `UserMessage` | `CoreUserMessage` | content 兼容：`string \| (TextPart \| ImagePart)[]` |
| `AssistantMessage` | `CoreAssistantMessage` | AI SDK 无 `api`, `provider`, `model` 字段在消息上；usage 结构不同 |
| `ToolResultMessage` | `CoreToolMessage` | 结构大改：pi-ai 单 toolCallId → AI SDK 嵌套 `ToolResultPart[]` |
| `ToolCall` | `ToolCallPart` | 字段基本一致：`id`, `name`, `arguments`/`args` |
| `TextContent` | `TextPart` | `{ type: "text", text }` — 兼容 |
| `ImageContent` | `ImagePart` | pi-ai `{ data, mimeType }` → AI SDK `{ image: Buffer\|URL, mimeType }` |
| `ThinkingContent` | `ReasoningPart` | AI SDK: `{ type: "reasoning", text, signature }` |
| `Tool<TSchema>` | `tool({ description, parameters, execute })` | AI SDK tool 自带 execute，pi-ai 的 Tool 仅定义 schema |
| `Usage` | `LanguageModelUsage` | 字段差异：pi-ai 有 `cacheRead/cacheWrite/cost` 等详细字段 |
| `StopReason` | `FinishReason` | pi-ai: `"stop"\|"length"\|"toolUse"\|"error"\|"aborted"` → AI SDK: `"stop"\|"length"\|"tool-calls"\|"error"\|"other"` |
| `Model<Api>` | `LanguageModel` (from `ai` package) | AI SDK Model 是 opaque interface，不暴露 `contextWindow`/`maxTokens` 等 |

### 2.3 Provider 支持

| 现有 Provider | pi-ai 内置 | AI SDK 对应包 | 备注 |
|--------------|-----------|--------------|------|
| `anthropic` | ✅ `getModel("anthropic", ...)` | `@ai-sdk/anthropic` | ✅ 完整支持 |
| `openai` | ✅ | `@ai-sdk/openai` | ✅ 完整支持 |
| `google` / `google-vertex` | ✅ | `@ai-sdk/google` / `@ai-sdk/google-vertex` | ✅ 完整支持 |
| `moonshot` / `kimi` | ✅ (custom baseUrl) | `@ai-sdk/openai` compatible + custom baseURL | ⚠️ 需手动构造 OpenAI-compatible provider |
| `kimi-coding` | ✅ 内置 | 无原生支持 | ⚠️ 需 OpenAI-compat 模式 + custom baseURL |
| `openrouter` | ✅ | `@openrouter/ai-sdk-provider` 或 OpenAI-compat | ⚠️ 第三方包 |
| `deepseek` | ✅ | `@ai-sdk/openai` compatible | ⚠️ 需 custom baseURL |
| `xai` / `groq` / `mistral` | ✅ | `@ai-sdk/xai` / `@ai-sdk/groq` / `@ai-sdk/mistral` | ✅ 有官方 provider |

> ⚠️ 纠正注记（2026-04-10）：
> - 上表中的 `deepseek | pi-ai 内置 = ✅` 为**错误判断**。  
> - 当前仓库安装的 `@mariozechner/pi-ai@0.62.0` 的 `KnownProvider` 不包含 `deepseek`，见：  
>   `node_modules/.pnpm/@mariozechner+pi-ai@0.62.0_ws@8.20.0_zod@4.3.6/node_modules/@mariozechner/pi-ai/dist/types.d.ts:5`  
> - 正确做法：  
>   - 在现状评估里把 `deepseek` 标记为“pi-ai 默认不内建；需 custom mapping/兼容层”；  
>   - 迁移到 AI SDK 后可通过 OpenAI-compatible provider 路径接入。

### 2.4 MCP 能力

| 能力 | pi-ai 现状 | AI SDK 支持 |
|------|-----------|-------------|
| MCP Tool 描述 → LLM Tool 注册 | 自行适配 (`mcp/tool-adapter.ts`) | `experimental_createMCPClient()` 内置 MCP 支持 |
| MCP Tool 调用 → `callTool()` | 自行实现 (`mcp/stdio-client.ts`) | AI SDK 内置 MCP client 自动桥接 |
| MCP schema → Tool parameters | 手工 cast `as TSchema` | AI SDK 自动转换 JSON Schema → Zod |

> ⚠️ 纠正注记（2026-04-10）：
> - 本段“自动桥接/自动转换”目前属于**方案假设**，不是仓库内已验证事实。  
> - 正确做法：在 Phase 0 增加一个最小 MCP spike（列工具 + 调一次工具）并记录证据，再决定是否替换现有 `mcp/stdio-client.ts`。

### 2.5 错误处理

| pi-ai 方式 | AI SDK 方式 |
|-----------|-------------|
| `AssistantMessage.stopReason === "error"` | `result.finishReason === "error"` 或 catch `AICallError` |
| `AssistantMessage.errorMessage` | `AICallError.message` / `result.warnings` |
| `AbortSignal` → `stopReason === "aborted"` | `AbortSignal` → throws `AbortError` |

---

## 3. 兼容性要求：必须保持不变的行为

### 3.1 Model Config 优先级链（🔴 关键）

当前 `model-resolver.ts` (L134-155) 实现的 resolution 链：

```
conversation config → account config → global config → env-var default
```

**此行为必须 100% 保留**，包括：
- `ModelConfigStore` 端口接口不变
- `resolveModel()` 返回 `ResolvedModel { model, modelId, apiKey }` 签名不变
- `buildModelFromConfig()` 支持 Moonshot/Kimi 的 custom baseUrl 特殊逻辑
- 缓存 TTL（60s）和 `invalidateModelCache()` 行为不变
- `ModelPurpose` ("chat" | "extraction") 以及 wildcard "*" 匹配

### 3.2 消息持久化格式

当前 `MessageStore.queuePersistMessage()` 将 pi-ai `Message` 对象序列化为 JSON 存入 Supabase `payload` 字段（见 `docs/web-architecture.md` L97-105）。

**要求**：
- 迁移后新消息的 `payload` 格式独立于 SDK 类型，或提供 backwards-compatible 序列化
- 已有 `payload` 数据（pi-ai Message JSON）必须能被新代码反序列化加载到历史
- `RestoredHistory` 返回的 `Message[]` 被 runner loop 和 context-window 直接消费

> ✅ 已决策补充（Top-1）：采用“读旧写新”，不做一次性全量 migration。  
> - 旧数据兼容范围：仅保证**读兼容**（restore/load 历史可用）  
> - 新数据策略：统一写入新 payload 结构  
> - 目标：避免历史会话断裂，同时降低批量迁移风险

### 3.3 工具执行链路

```
runner.ts: complete() → toolCall extraction → tools.execute() → buildToolResult() → next round
```

**要求**：
- `ToolRegistry.current().tools` 返回的 tool 描述格式兼容新 LLM 调用
- `ToolSnapshotItem` 接口（name/description/parameters/execute）保持稳定
- MCP tool adapter 输出与本地 tool 输出格式统一
- `USE_SKILL_TOOL` 内联工具定义方式兼容

### 3.4 Context Window 管理

`context-window.ts` 依赖 `Model.contextWindow` 和 `Model.maxTokens` 来计算 token budget（见 `runner.ts` L224-230）。

**要求**：
- AI SDK `LanguageModel` 不直接暴露 `contextWindow`/`maxTokens`，需自行维护或包装

### 3.5 可观测性集成

`runner.ts` 使用 `@clawbot/observability` 的 `withSpan()` 记录 LLM 调用细节，包括 `inputTokens`, `outputTokens`, `stopReason`, `model` 等字段。

**要求**：
- 迁移后 span attributes 字段名和语义保持一致
- `llmLatencyMs`, `llmErrorsTotal`, `toolCallsTotal` 等 metrics 不受影响

---

## 4. 差距与风险

### 4.1 技术风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| **Model 元数据丢失** | 🔴 高 | pi-ai `Model` 包含 `contextWindow`, `maxTokens`, `cost`, `reasoning`, `input` 等运行时元数据。AI SDK `LanguageModel` 是 opaque 接口，不暴露这些字段。context-window 裁剪、token budget 计算将失去数据源。 |
| **TypeBox → Zod 全面迁移** | 🔴 高 | 所有通过 `Type.*` 构建的 tool parameter schema（4 个文件）和 markdown tool compiler 的动态 schema 构建逻辑都需改写。AI SDK 强制 Zod，不接受 TypeBox。 |
| **消息格式不兼容** | 🔴 高 | pi-ai `ToolResultMessage` vs AI SDK `CoreToolMessage` 结构差异大（单 toolCallId vs nested ToolResultPart[]）。DB 中已有 pi-ai Message 格式的 payload 需要转换层。 |
| **getModel() 全局注册表消失** | 🟡 中 | pi-ai 提供 `getModel(provider, modelId)` 全局查询；AI SDK 需为每个 provider 单独实例化。`buildModelFromConfig()` 需重构为 provider factory 模式。 |
| **stopReason 语义偏移** | 🟡 中 | `"toolUse"` → `"tool-calls"`, `"aborted"` 无直接对应（AI SDK 抛异常而非 status）。runner.ts 的状态机需调整。 |
| **abort 行为差异** | 🟡 中 | pi-ai `complete()` 在 abort 时返回 `AssistantMessage { stopReason: "aborted" }`；AI SDK 抛 `AbortError`。runner.ts L280-282 的 abort 处理需改为 try-catch。 |

> ⚠️ 纠正注记（2026-04-10）：
> - “pi-ai abort 一定返回 `stopReason: aborted`”目前在本仓库缺少直接证据，应标记为**待验证行为**。  
> - 已确认事实：`runner.ts` 对 `complete()` 的异常分支会 `throw`（见 `packages/agent/src/runner.ts` L273-279）。  
> - 正确做法：补一个 abort 集成测试，分别验证 pi-ai 与 AI SDK 的中断语义，再决定状态机映射策略。

### 4.2 数据风险

| 风险 | 严重度 | 说明 |
|------|--------|------|
| **历史消息反序列化** | 🔴 高 | Supabase `messages.payload` 存储的是 pi-ai `Message` JSON。迁移后 `restoreHistory()` 返回的对象需要被 AI SDK 的 `generateText` 消费。需要 message adapter 层。 |
| **Usage 统计格式变化** | 🟡 中 | pi-ai `Usage` 包含 `cacheRead`, `cacheWrite`, `cost.*` 等字段；AI SDK `LanguageModelUsage` 仅有基础 token 计数。可观测性 span 和潜在的成本统计将丢失细节。 |

### 4.3 回归风险

| 场景 | 影响 |
|------|------|
| agent loop 多轮工具调用 | runner.ts 是最复杂的调用者，涉及 tool dispatch、message 推送、abort、metrics。回归测试覆盖面大。 |
| 记忆提取 JSON 解析 | extractor.ts 依赖 `complete()` 返回的 `AssistantMessage.content` 提取 JSON；格式变化可能导致解析失败。 |
| 心跳推理 | reason-internal.ts 的单轮调用模式简单，但 model config inheritance 逻辑不能出错。 |
| Context window 裁剪 | token-estimator.ts 和 context-window.ts 依赖 pi-ai 消息类型的精确结构做 block 级估算。 |

### 4.4 性能风险

| 风险 | 说明 |
|------|------|
| **冷启动延迟** | AI SDK provider packages 多文件 lazy import 模式，首次调用可能有额外初始化开销。 |
| **Bundle 体积** | pi-ai 单包约 100K；AI SDK core + 4-5 provider 包可能更大，影响 server 启动。 |
| **prompt cache 差异** | pi-ai 支持 `cacheRetention` / `sessionId`；AI SDK 的 cache 控制依赖 provider 自身实现，可能丢失优化。 |

---

## 5. 迁移方案：分阶段改造

### Phase 0: 基础设施准备（预计无功能变化）

**目标**：引入 AI SDK 依赖，建立 adapter/shim 层，不修改现有行为。

**改动文件**：
- `packages/agent/package.json` — 添加 `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `zod` 依赖
- 新建 `packages/agent/src/llm/types.ts` — 定义项目内部的 `LlmMessage`, `LlmModel`, `LlmTool` 等中间类型
- 新建 `packages/agent/src/llm/adapter-piai.ts` — 将内部类型 ↔ pi-ai 类型相互转换
- 新建 `packages/agent/src/llm/adapter-aisdk.ts` — 将内部类型 ↔ AI SDK 类型相互转换
- 新建 `packages/agent/src/llm/provider-factory.ts` — AI SDK provider 工厂（替代 `getModel()`）

**验证方式**：`tsc --noEmit` 通过；现有测试不变。  
**回滚点**：删除新增文件，还原 `package.json`。

### Phase 1: Schema 系统迁移（TypeBox → Zod）

**目标**：将所有 `Type.*` 调用替换为 `z.*`，消除对 pi-ai TypeBox re-export 的依赖。

**改动文件**：
- `packages/agent/src/runner.ts` — `USE_SKILL_TOOL` 参数从 `Type.Object` → `z.object`
- `packages/agent/src/heartbeat/tool.ts` — 心跳工具参数迁移
- `packages/agent/src/scheduler/tool.ts` — 定时任务工具参数迁移
- `packages/agent/src/tools/compiler.ts` — Markdown tool 动态 schema 构建从 TypeBox → Zod
- `packages/agent/src/tools/types.ts` — `TSchema` → `z.ZodType` (或保留为 `unknown` 过渡)
- `packages/agent/src/mcp/tool-adapter.ts` — `TSchema` cast → `z.ZodType` 或 JSON Schema 桥接

**验证方式**：
- Markdown tool `.md` 文件编译测试（compiler 输出正确 Zod schema）
- 所有工具注册后 runner loop 可正常执行
- `tsc --noEmit` 通过

**回滚点**：Git revert 整个 phase 1 commit。

### Phase 2: 消息类型统一

**目标**：将项目内部的消息类型从 pi-ai `Message` 切换为内部中间类型（或直接 AI SDK `CoreMessage`）。

**改动文件**：
- `packages/agent/src/llm/types.ts` — 定义 `AgentMessage` union 类型
- `packages/agent/src/llm/message-compat.ts` — pi-ai Message ↔ AgentMessage 双向转换（支持 DB 历史数据）
- `packages/agent/src/conversation/history.ts` — 存储类型从 `Message` → `AgentMessage`
- `packages/agent/src/conversation/context-window.ts` — 类型替换
- `packages/agent/src/conversation/token-estimator.ts` — 类型替换
- `packages/agent/src/ports/message-store.ts` — `Message` → `AgentMessage`
- `packages/agent/src/chat.ts` — 消息提取函数类型替换
- `packages/agent/src/runtime/skill-runtime.ts` — 消息扫描类型替换
- `packages/server/src/db/message-store.impl.ts` — payload 序列化/反序列化适配
- `packages/server/src/db/messages.ts` — 实际 payload 编解码逻辑适配（`extractText`、`restoreHistory`、媒体裁剪/恢复）
- 新建 `packages/server/src/db/payload-adapter.ts`（建议）— 统一实现“旧格式读取适配 + 新格式写入编码”

> ⚠️ 纠正注记（2026-04-10）：
> - 原方案仅列出 `message-store.impl.ts`，这是**不完整**的。  
> - `message-store.impl.ts` 主要是委托层；真实消息结构处理在 `packages/server/src/db/messages.ts`，必须纳入 Phase 2 改造范围。

**验证方式**：
- DB 中已有 pi-ai 格式 payload 能正确 `restoreHistory()`
- 新消息 persist → restore roundtrip 无损
- context-window 裁剪行为不变
- 明确验证“读旧写新”：读到旧 payload 后写回新消息不回退为旧格式

**回滚点**：Git revert；DB payload 格式向下兼容。

### Phase 3: LLM 调用层替换

**目标**：将 `complete()` 调用全部替换为 `generateText()`。

**改动文件**：
- `packages/agent/src/runner.ts` — 核心 agent loop 改用 `generateText()`
  - `complete(effectiveModel, { systemPrompt, messages, tools }, opts)` → `generateText({ model, system, messages, tools, abortSignal, ... })`
  - 响应类型从 `AssistantMessage` → `GenerateTextResult`
  - `stopReason` → `finishReason` 映射
  - tool call 提取方式适配
  - abort 处理从 status 检查 → try-catch
- `packages/agent/src/tape/extractor.ts` — 单轮调用替换
- `packages/agent/src/heartbeat/reason-internal.ts` — 单轮调用替换
- `packages/agent/src/model-resolver.ts` — `getModel()` → provider factory，`Model<any>` → `LanguageModel`
  - `buildModelFromConfig()` 重写为 provider 实例化
  - `contextWindow` / `maxTokens` 元数据需挂载到 sidecar 结构
- `packages/server/src/ai.ts` — 启动时 model 构造方式替换
- 新建 `packages/agent/src/llm/model-metadata.ts` — 维护 model contextWindow/maxTokens 等 runner 需要的元数据

**验证方式**：
- 端到端聊天测试（单轮 + 多轮工具调用）
- 记忆提取触发并正确写入 tape
- 心跳推理正常执行
- 可观测性 span 字段完整
- AbortSignal 取消行为正确

**回滚点**：Git revert；保留 adapter-piai.ts 以快速切回。

### Phase 4: MCP 集成升级（可选优化）

**目标**：评估是否用 AI SDK 内置 MCP client 替换自建的 `mcp/stdio-client.ts`。

**改动文件**：
- `packages/agent/src/mcp/stdio-client.ts` — 评估替换为 `experimental_createMCPClient()`
- `packages/agent/src/mcp/tool-adapter.ts` — 可能简化或移除
- `packages/agent/src/mcp/types.ts` — 接口可能简化

**验证方式**：MCP server 连接、tool listing、tool 调用端到端测试。  
**回滚点**：保留现有 MCP 实现作为 fallback。

> **注意**：AI SDK 的 MCP 支持标记为 `experimental_`，需评估稳定性后再决定是否采纳。如果 AI SDK MCP 不满足需求（如自定义 transport、细粒度错误处理），可保留当前自建 MCP 层并仅替换 tool-adapter 的 schema 格式。

### Phase 5: 清理与移除 pi-ai

**目标**：移除所有 pi-ai 依赖。

**改动文件**：
- `packages/agent/package.json` — 移除 `@mariozechner/pi-ai`
- `packages/server/package.json` — 移除 `@mariozechner/pi-ai`
- 删除 `packages/agent/src/llm/adapter-piai.ts`
- 更新 `.env.example` 注释
- 更新 `README.md` 技术栈描述
- 更新 `docs/` 中引用 pi-ai 的文档

**验证方式**：`pnpm install` → `tsc --noEmit` → 全量测试通过。  
**回滚点**：Git revert 恢复 pi-ai 依赖。

---

## 6. 验收标准

### 6.1 功能验收

| 验收项 | 验证方法 |
|--------|----------|
| 单轮聊天正常回复 | 微信发送文本消息，收到正确回复 |
| 多轮工具调用（>= 3 轮） | 触发需要工具的指令（如定时任务、技能加载），验证 tool loop 完整执行 |
| 图片消息处理 | 发送图片，验证 vision model 正确处理 |
| 记忆提取 | 聊天后检查 tape 表有新记忆条目 |
| 心跳推理 | 创建 pending goal，等待心跳执行并产生正确评估 |
| Model config 优先级 | 设置 conversation/account/global 不同模型配置，验证 resolve 顺序 |
| 定时任务工具 | 创建 cron 任务，验证工具参数 schema 正确 |
| MCP 工具注册 | 配置 MCP server，验证工具列表加载和调用 |
| Abort 取消行为 | 长运行对话中发送新消息，验证旧请求正确取消 |
| Moonshot/Kimi provider | 使用 Moonshot provider 配置，验证自定义 baseUrl 和 API key 工作 |

### 6.2 测试验收

| 要求 | 标准 |
|------|------|
| 现有测试全部通过 | `pnpm --filter @clawbot/agent test` 零失败 |
| 新增 adapter 层单测 | message 转换、provider factory、schema 转换覆盖 |
| DB payload 兼容性测试 | 旧 pi-ai 格式 payload restore → 新格式 roundtrip |
| `tsc --noEmit` 零新增错误 | 类型安全保障 |

### 6.3 日志与可观测性

| 要求 | 标准 |
|------|------|
| LLM 调用 span | 包含 `inputTokens`, `outputTokens`, `finishReason`, `model` |
| tool 执行 span | 包含 `toolName`, 参数 snapshot, 结果 snapshot |
| context-window span | 包含 `trimLevel`, `originalTokens`, `trimmedTokens`, `droppedMessageCount` |
| `llmLatencyMs` histogram | 按 model label 分桶，毫秒级 |
| `llmErrorsTotal` counter | 区分 `error` / `aborted` |

### 6.4 性能验收

| 指标 | 基线 | 允许范围 |
|------|------|----------|
| 首轮聊天延迟（不含 LLM） | 测量现有值 | ≤ +50ms |
| Node 进程内存 | 测量现有值 | ≤ +20MB |
| `pnpm install` 耗时 | 测量现有值 | ≤ +30s |

---

## 7. 待确认问题列表

| # | 问题 | 阻塞阶段 | 建议默认值 |
|---|------|----------|-----------|
| 1 | **是否引入项目内部中间消息类型，还是直接使用 AI SDK `CoreMessage`？** 中间类型增加复杂度但降低 SDK 耦合；直接用 CoreMessage 减少代码但与 SDK 绑定。 | Phase 2 | 建议：引入 `AgentMessage` 中间类型 — 项目已有 ports 模式的 DI 架构风格，保持一致。 |
| 2 | **Model 元数据（contextWindow, maxTokens）如何维护？** AI SDK 不暴露这些字段；context-window trimming 需要它们。 | Phase 3 | 建议：创建 `ModelMetadataRegistry` 静态映射表，启动时从配置加载，或在 provider factory 中硬编码常用模型元数据。 |
| 3 | **DB payload 格式是否做一次性 migration？** 还是保留双向 adapter 永久兼容旧格式？ | Phase 2 | ✅ **已决策（Top-1）**：采用“读旧写新”，不做一次性 migration。保留读取旧格式 adapter；新写入统一新格式。 |
| 4 | **Moonshot / Kimi 的 OpenAI-compatible 模式是否可靠？** 需验证 AI SDK `createOpenAI({ baseURL })` 对这些 provider 的兼容性。 | Phase 3 | 建议：Phase 0 中编写 smoke test 脚本，验证 Moonshot/Kimi baseURL + API key 可正常返回。 |
| 5 | **是否采用 AI SDK 内置 MCP 支持（`experimental_`）？** 当前自建 MCP 层功能完整且稳定。 | Phase 4 | 建议：Phase 4 标记为可选。保留自建 MCP，仅适配 tool schema 格式（TypeBox → Zod）。待 AI SDK MCP 稳定后再评估替换。 |
| 6 | **`cacheRetention` / `sessionId` 等 pi-ai 特有 API 调用选项如何处理？** | Phase 3 | 建议：暂时忽略 — 当前代码未显式使用这些选项（均使用默认值）。后续通过 AI SDK provider options 按需回补。 |
| 7 | **Usage 中 `cacheRead`/`cacheWrite`/`cost` 详细字段是否需要保留？** | Phase 3 | 建议：可观测性 span 仅记录 AI SDK 原生提供的字段。cost 计算如需要，可后续在 observability 层从 model metadata 推算。 |
| 8 | **是否同步迁移 `packages/agent/src/test/` 下的测试？** | Phase 1-3 | 建议：每个 phase 同步更新测试，不单独成 phase。 |

---

## 附录 A：pi-ai 完整 API 清单 (v0.62.0)

```
# 函数
complete(model, context, options?) → Promise<AssistantMessage>
stream(model, context, options?) → EventStream
completeSimple(model, context, options?) → Promise<AssistantMessage>
streamSimple(model, context, options?) → EventStream
getModel(provider, modelId) → Model
getProviders() → KnownProvider[]
getModels(provider) → Model[]
calculateCost(model, usage) → Usage["cost"]
getEnvApiKey(provider) → string | undefined

# Re-exports from @sinclair/typebox
Type.Object(), Type.String(), Type.Number(), Type.Integer(),
Type.Boolean(), Type.Optional(), Type.Union(), Type.Literal()
type TSchema, type Static
```

## 附录 B：受影响文件完整索引

| 文件路径 | 依赖方式 | Phase |
|----------|----------|-------|
| `packages/agent/src/runner.ts` | `complete`, `Type.*`, 多种消息类型 | 1, 2, 3 |
| `packages/agent/src/chat.ts` | 消息类型 | 2 |
| `packages/agent/src/model-resolver.ts` | `getModel`, `Model` | 3 |
| `packages/agent/src/tape/extractor.ts` | `complete`, `Model` | 3 |
| `packages/agent/src/heartbeat/reason-internal.ts` | `complete` | 3 |
| `packages/agent/src/heartbeat/tool.ts` | `Type.*` | 1 |
| `packages/agent/src/scheduler/tool.ts` | `Type.*` | 1 |
| `packages/agent/src/tools/compiler.ts` | `Type.*`, `TSchema` | 1 |
| `packages/agent/src/tools/types.ts` | `Tool`, `TSchema`, 内容类型 | 1, 2 |
| `packages/agent/src/mcp/tool-adapter.ts` | `TSchema` | 1 |
| `packages/agent/src/conversation/history.ts` | `Message` | 2 |
| `packages/agent/src/conversation/context-window.ts` | 多种消息类型 | 2 |
| `packages/agent/src/conversation/token-estimator.ts` | 多种消息类型+内容类型 | 2 |
| `packages/agent/src/ports/message-store.ts` | `Message` | 2 |
| `packages/agent/src/runtime/skill-runtime.ts` | `Message`, `ToolResultMessage` | 2 |
| `packages/server/src/db/messages.ts` | `Message`, `TextContent`, `ImageContent`（运行时编解码） | 2 |
| `packages/server/src/ai.ts` | `Model` (type-only) | 3 |
| `packages/agent/package.json` | 依赖声明 | 5 |
| `packages/server/package.json` | 依赖声明 | 5 |
