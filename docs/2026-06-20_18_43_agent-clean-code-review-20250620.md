# 🧹 `@clawbot/agent` 代码洁癖评审报告

> 评审日期：2026-06-20  
> 评审范围：`packages/agent/src/` 全部源文件  
> 评审标准：《代码整洁之道》(Clean Code)、《重构》(Refactoring)、《整洁架构》(Clean Architecture)

---

## 一、评审方法

以三本书的核心原则为检查清单，逐条对照：

| 来源 | 核心原则 |
|------|---------|
| **Clean Code** | 有意义的命名、短函数、SRP（单一职责）、DRY、好注释/坏注释、错误处理 |
| **Refactoring** | 代码坏味道：长函数、长参数列表、重复代码、switch 语句、数据泥团、基本类型偏执、全局可变状态 |
| **Clean Architecture** | 依赖规则、实体/用例/适配器/框架分层、接口隔离、边界清晰 |

---

## 二、函数长度（Clean Code: "函数应该短小"）

> **原则**：函数应该做一件事、做好一件事、只做一件事。超过 30 行应警惕。

### 🔴 严重超标

| 函数 | 文件 | 行数 | 职责数 |
|------|------|------|--------|
| `chat()` | `chat.ts:82-269` | **187 行** | 加载历史、召回记忆、构建消息、处理图片、运行 LLM、回滚、记忆抽取、压缩 |
| 内部 `run()` | `runner.ts:209-443` | **234 行** | 上下文裁剪、工具序列化、系统提示组装、LLM 调用、工具执行路由、指标记录、兜底处理 |
| `createStdioMcpClient()` | `mcp/stdio-client.ts:167-437` | **270 行** | 进程管理、JSON-RPC 组帧、请求/响应关联、排他队列、协议协商、工具列表、工具调用、关闭 |

**分析**：这三个函数是系统核心路径，但都违反 SRP 到了"上帝函数"的程度。`chat()` 一个人做了整个对话流程中 6 件独立的事，`run()` 把工具调用循环的所有细节内联在一个 `for` 循环里。

### 🟡 中等超标

| 函数 | 文件 | 行数 | 问题 |
|------|------|------|------|
| `executeTask()` | `scheduler/executor.ts:20-124` | **104 行** | prompt 执行 + handler 执行 + 推送 + 故障计数 + 自动暂停 + once 禁用 |
| `describeImageWithVisionModel()` | `vision.ts:302-392` | **90 行** | span 管理 + LLM 调用 + 部分 JSON 恢复 + 校验 |
| `evaluateGoal()` | `heartbeat/evaluator.ts:226-313` | **87 行** | token 预算 + 上下文加载 + Phase 1 + verdict 分发 + Phase 2 + 结果分析 |
| `provisionWithAdapter()` | `skills/runtime-provisioner.ts:399-456` | **57 行** | 工具链检查 + 环境准备 + 依赖安装 + 入口验证 + 元数据写入 + 错误恢复 |

---

## 三、函数参数（Clean Code: "函数参数越少越好"）

> **原则**：理想是 0 参数，其次是 1 个，再次是 2 个。3 个以上需要特别理由。

### 🔴 参数过多

| 函数 | 参数数 | 签名 |
|------|--------|------|
| `fireExtractAndRecord()` | **6 个** | `model, accountId, sessionBranch, turn, actor, apiKey?` |
| `chat()` | **5 个** | `accountId, conversationId, text, media?, startedAt` |

**`fireExtractAndRecord()` 尤为突出** —— 6 个参数中 `model` 和 `apiKey?` 来自调用方 `chat()` 的模型解析链，`turn` 内部只有 `userText` 和 `assistantText` 两个字段被使用。这是典型的"数据泥团"前兆。

**建议**：

```typescript
// 当前：6 个独立参数
function fireExtractAndRecord(model, accountId, sessionBranch, turn, actor, apiKey?) { }

// 建议：参数对象
interface ExtractionParams {
  model: LanguageModel;
  accountId: string;
  sessionBranch: string;
  turn: ConversationTurn;
  actor: string;
}
function fireExtractAndRecord(params: ExtractionParams) { }
```

---

## 四、单一职责原则 SRP（Clean Code: "一个函数只做一件事"）

### 🔴 严重违反

**`chat()` — 目前承担 8 个独立职责**：

```
1. 并行加载历史 & 召回记忆       (lines 100-113)
2. 组装用户消息 + 图片预处理     (lines 119-139)
3. 持久化用户消息               (lines 148-154)
4. 运行 LLM agent              (lines 160-205)
5. 错误响应回滚                 (lines 217-222)
6. 记忆抽取（fire-and-forget)   (lines 226-241)
7. 记忆压缩                     (lines 244-246)
8. 构建最终回复（含 debug 标注） (lines 249-266)
```

**建议**：拆分为独立函数，`chat()` 仅做编排：

```typescript
async function chat(accountId, conversationId, text, media?, startedAt?) {
  const [history, memory] = await loadContext(accountId, conversationId);
  const userMessage = buildUserMessage(text, media, memory, chatModel, accountId, conversationId);
  persistUserMessage(accountId, conversationId, userMessage);
  const result = await runner.run(history, callbacks, signal, modelOverride);
  handleRunResult(result, accountId, conversationId, text, messagesAddedInRun, chatModel, startedAt);
}
```

**`run()` (内部) — 工具调用循环中内联了太多细节**：

最严重的部分是 `use_skill` 的内联特殊处理（lines 386-392）：

```typescript
result = toolCall.name === USE_SKILL_TOOL.name
  ? await skillRuntime.execute(...)
  : await tools.execute(...);
```

这违反了**开闭原则** —— 每次新增 runner 内建工具都需要修改 `run()` 的代码。`use_skill` 完全可以通过 `ToolRegistry` 注册，和其他工具走相同的执行路径。

---

## 五、DRY 原则 —— 重复代码

### 🔴 JSON 解析 + fallback 重复

**文件 1** — `heartbeat/evaluator.ts:34-58` (`parseEvalResult`)  
**文件 2** — `vision.ts:76-88` (`extractJsonText`)

两个函数都实现了相同的策略链：先 `JSON.parse(raw)` → 失败则正则提取 `{...}` → 再失败则关键词 fallback / 返回 null。核心逻辑相同，只是第二步的后续处理不同（evaluator 有关键词兜底，vision 没有）。

**建议**：提取通用函数：

```typescript
function extractJsonBlock(text: string): string | null {
  // 1. 尝试提取 markdown fenced code block
  // 2. 尝试正则 { ... }
  // 两个模块共享
}
```

### 🟡 `Promise.race` + `setTimeout` 超时模式重复

`executor.ts:38-42` 和 `executor.ts:54-59` 中几乎一模一样的模式：

```typescript
const result = await Promise.race([
  someAsyncFn(),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new TimeoutError()), EXECUTION_TIMEOUT_MS),
  ),
]);
```

**建议**：提取为 `withTimeout(fn, ms)` 工具函数。

### 🟡 `pythonAdapter` / `nodeAdapter` 结构重复

`runtime-provisioner.ts` 中两个 adapter 对象（lines 130-253 和 255-379）拥有相同的 7 个方法签名，但实现完全不同。`healthCheck` 的逻辑结构几乎一样（检查入口文件 → 尝试语法检查 → 返回结果），但没有抽象共享。

**当前**：

```
pythonAdapter (124 行)   nodeAdapter (124 行)
├─ ensureToolchain        ├─ ensureToolchain
├─ validateEntrypoint     ├─ validateEntrypoint
├─ prepareEnv             ├─ prepareEnv
├─ verifyEntrypoint       ├─ verifyEntrypoint
├─ buildInstall (60行)    ├─ buildInstall (73行)
├─ cleanArtifacts         ├─ cleanArtifacts
└─ healthCheck            └─ healthCheck
```

`validateEntrypoint` 两个 adapter 完全一致（都是调用 `ensureEntrypointExists(skill, skillDir, runtime)`），可以上提到公共函数。

### 🟡 `recall().catch(() => emptyState)` 模式重复

- `chat.ts:107-111`：两次 `recall().catch()` 返回 `emptyState()`
- `tape/extractor.ts:185-188`：同样的模式

**建议**：提供一个 `safeRecall()` 包装：

```typescript
async function safeRecall(accountId: string, branch: string): Promise<TapeState> {
  return recall(accountId, branch).catch((err) => {
    console.warn(`[tape] recall failed for ${accountId}/${branch}:`, err);
    return emptyState();
  });
}
```

---

## 六、Switch 语句坏味道（Refactoring: "用多态替换条件表达式"）

### 🟡 `evaluateGoal()` 中的 verdict 分发

`heartbeat/evaluator.ts:260-309` 使用一系列 `if/else if` 做状态分发：

```typescript
if (verdict === "resolve") { return resolved(...); }
if (verdict === "abandon" || goal.checkCount + 1 >= goal.maxChecks) { return abandoned(...); }
if (verdict === "wait") { return pendingWithBackoff(...); }
// verdict === "act" → Phase 2 execution
```

**建议**：Strategy 映射表：

```typescript
const verdictHandlers: Record<Verdict, (goal, context) => Promise<GoalTransition>> = {
  resolve: (goal, ctx) => resolved(goal, ...),
  wait: (goal, ctx) => pendingWithBackoff(goal, ...),
  abandon: (goal, ctx) => abandoned(goal, ...),
  act: (goal, ctx) => executePhase2(goal, ctx),
};
return verdictHandlers[verdict](goal, context);
```

### 🟡 `fold()` 中的 category switch

`tape/fold.ts` 对 `entry.category` 做了 `switch`，每个 case 执行完全不同的折叠逻辑。可用 Strategy 映射表替代。

### 🟡 `context-window.ts` 三级裁剪

Level 0 / Level 1 / Level 2 是三个顺序 `if` 块。符合**责任链模式**（Chain of Responsibility）的经典场景：

```typescript
const trimmer = chainOf(
  noOpTrimmer,        // Level 0
  imageDegradeTrimmer, // Level 1
  slidingWindowTrimmer // Level 2
);
return trimmer.trim(messages, budget);
```

---

## 七、基本类型偏执（Refactoring: "用对象替换基本类型"）

### 🔴 `accountId` + `conversationId` 数据泥团

这两个字符串在 **~30 处**函数签名中成对出现：

| 文件 | 出现次数 |
|------|---------|
| `conversation/history.ts` | 8 个函数 |
| `tape/service.ts` | 5 个函数 |
| `heartbeat/` | 4 个函数 |
| `chat.ts`、`model-resolver.ts`、`vision.ts` | 各 1-3 处 |

**建议**：引入值对象 `ConversationRef`：

```typescript
// 当前：数据泥团
async function recall(accountId: string, branch: string): Promise<TapeState> { ... }
async function chat(accountId: string, conversationId: string, text: string): Promise<ChatResponse> { ... }

// 建议：值对象
type ConversationRef = { readonly accountId: string; readonly conversationId: string };
async function recall(ref: ConversationRef, branch: string): Promise<TapeState> { ... }
async function chat(ref: ConversationRef, text: string): Promise<ChatResponse> { ... }
```

这不是"为抽象而抽象"——这两个值总是绑定在一起传递，永不分离。值对象还能防止参数顺序错误（`string, string` 是无区别的类型）。

### 🟡 魔法字符串

| 字符串 | 使用位置 | 建议 |
|--------|---------|------|
| `"__global__"` | `chat.ts:108`, `tape/extractor.ts:175` | `GLOBAL_BRANCH = "__global__"` 常量 |
| `"prompt"` taskKind | `executor.ts:36` | 枚举 `TaskKind.PROMPT` |
| `"scheduler:{seq}"` | `executor.ts:28` | `schedulerConversationId(seq)` 函数 |
| `"chat"`, `"extraction"`, `"vision"` | `model-resolver.ts` 多处 | 枚举 `ModelPurpose` |
| `"accountId::conversationId"` 拼接 | `history.ts:23-25` | 封装为 `ConversationRef.key()` |

### 🟡 字符串联合类型用作枚举

```typescript
// heartbeat/types.ts
export type GoalStatus = "pending" | "checking" | "waiting_user" | "resolved" | "abandoned";
export type GoalOrigin = "conversation" | "tool_failure" | "follow_up";
```

TypeScript 字符串联合类型在类型层面没问题，但运行时比较 `=== "pending"` 分布在多个文件中。如果字符串值发生变化，所有文件都需要改。使用 `const` 枚举或字符串常量对象能提供单一真理源。

---

## 八、注释质量（Clean Code: "好注释 / 坏注释"）

### ✅ 好注释

- **`chat.ts:1-6`** JSDoc：说明 `chat()` 的职责和与传输层的解耦
- **`context-window.ts:1-10`** 三级裁剪策略的完整说明
- **`composite-registry.ts:19-21`** 合并优先级和去重策略
- **`provider-factory.ts:200-202`** DeepSeek workaround 的原因
- **`scheduler/tool.ts:14-29`** `validateMinInterval` 的设计意图
- **`runner.ts:252-255`** system prompt 每轮重组的必要性

### 🟡 冗余注释（应删除或改为更精确的注释）

| 注释 | 文件:行 | 问题 |
|------|---------|------|
| `// Build AI SDK tools (schema only, no execute)` | `runner.ts:296` | 代码已自解释，注释多余 |
| `// 没有 tool-call 就说明这一轮已经产生最终回复` | `runner.ts:355` | 翻译代码而非解释意图 |
| `// 1. Find the latest anchor` | `tape/service.ts:38` | 步骤编号注释是拆分函数的信号 |
| `// 2. Read incremental entries` | `tape/service.ts:42` | 同上 |
| `// 3. Fold` | `tape/service.ts:48` | 同上 |
| `// ── Verdict parsing ──` | `evaluator.ts:26` | ASCII 分隔线噪声，模块结构已足够清晰 |
| `// ── Tool definitions ──` | `scheduler/tool.ts:59` | 同上 |

**关于注释的一条 Clean Code 原则**："每次你用一个注释来拆分函数内部逻辑，你其实应该把这个逻辑提取为独立函数。"`tape/service.ts` 的 `// 1.` `// 2.` `// 3.` 注释恰好证明了 `recall()` 的三个步骤应该独立为子函数。

### ✅ 无被注释掉的代码

整个代码库没有遗留的"僵尸代码"——值得肯定。

---

## 九、嵌套深度（Clean Code: "不要超过 3 层"）

### 🔴 `runner.ts` — 最深 6 层嵌套

```
async function run() {                     // 1
  for (let round = 1; ...) {               // 2
    try {                                   // 3
      response = await withSpan(            // 4
        async (span) => {                   // 5
          const result = await generateText( // 6
            { model, system, messages, tools, abortSignal }
          );
```

**核心原因**：`withSpan()` 的 callback 模式创造了两层固有嵌套。`for` 循环 + `try` + `withSpan` + `async callback` = 6 层。

**建议**：
- 将 LLM 调用提取为独立函数，减少 callback 嵌套
- 或将 `withSpan` 替换为不依赖 callback 的模式（装饰器 / 拦截器）

### 🟡 `mcp/stdio-client.ts` — `connect()` 4 层

```
async connect() {                           // 1
  try {                                     // 2
    const initResult = await request(...);  // 3
    if (protocolVersion === undefined) {    // 4
      throw new Error(...);
```

---

## 十、全局可变状态（Clean Architecture: "边界处的依赖规则"）

### 当前状态

| 模块 | 全局可变状态 | 类型 |
|------|------------|------|
| `chat.ts` | `let _deps` | 单例 |
| `conversation/history.ts` | 5 个 `Map` + 1 个 `string[]` | 全局缓存 |
| `model-resolver.ts` | `cache` Map | 全局缓存 |
| `scheduler/manager.ts` | `activeJobs` Map | 运行时状态 |
| `heartbeat/engine.ts` | `tickTimer`, `inflight`, `accountQueues` | 运行时状态 |
| `tape/queue.ts` | 写入队列 | 运行时状态 |
| `prompts/port.ts` | Prompt assets | 不可变配置 |
| `scheduler/tool.ts` | `schedulerContext` | 请求作用域 |

**生产场景定位**（已完成校准）：本项目的使用场景是「单进程服务多个账号」，多账号隔离已通过 `Map<accountId::conversationId, ...>` 复合键实现，全局单例在**生产并发正确性方面没有问题**，实际影响面仅限于**测试隔离**。

**Clean Architecture 视角**：当前设计属于"Main 组件通过 setter 注入依赖"模式，在单进程场景下是可接受的。如果要追求严格的分层，可以将 `conversation/history.ts` 的 5 个 `Map` 封装为一个 `ConversationCache` 类，通过工厂函数注入——这是纯代码组织层面的改善，不影响运行时行为。

---

## 十一、整洁架构分层评估

### 当前分层

```
┌────────────────────────────────┐
│  Ports (接口定义)               │  ← 用例边界
├────────────────────────────────┤
│  chat / runner / heartbeat     │  ← 用例 / 领域逻辑
│  scheduler / tape / skills     │
├────────────────────────────────┤
│  LLM adapters / MCP client     │  ← 接口适配器
├────────────────────────────────┤
│  node-cron / ai-sdk            │  ← 框架 & 驱动
└────────────────────────────────┘
```

### ✅ 做得好的

- **Ports 层完全独立**：12 个端口接口零依赖，完全符合依赖反转原则（DIP）
- **领域逻辑不依赖框架**：`chat()`、`runner`、`heartbeat` 等核心逻辑通过 Port 接口与数据库/推送解耦
- **工具注册表组合模式**：新增工具来源不需要修改现有代码，符合开闭原则（OCP）

### 🟡 跨层污染

| 位置 | 问题 | 违反原则 |
|------|------|---------|
| `scheduler/manager.ts` | `import { schedule } from "node-cron"` — 框架直接依赖 | 依赖规则：领域层不应依赖框架 |
| `scheduler/executor.ts` | `import { deactivate } from "./manager.js"` — 执行器知道管理器的内部实现 | 接口隔离：执行器不应依赖管理器的生命周期细节 |
| `runner.ts` | `use_skill` 工具的内联特殊处理 — runner 知道 skill 的加载机制 | 开闭原则：新增内建工具类型需要修改 runner |
| `chat.ts` | 直接操作 `history.push()` + `messageStore.queuePersistMessage()` — 编排器绕过历史模块的接口 | 得墨忒耳法则：chat 不应知道 history 的内部 |

---

## 十二、其他坏味道

### 🟡 特性依恋（Feature Envy）

**`chat.ts` 对 `conversation/history.ts`**：

```typescript
// chat.ts:148-153 —— chat() 直接操作 history 模块的内部状态
history.push(userMessage);                       // 应该通过 history.appendMessage()
messageStore.queuePersistMessage({               // 应该封装在 history 模块内
  accountId, conversationId, message: userMessage,
  seq: nextSeq(accountId, conversationId),
});
```

`history.push()` + `nextSeq()` + `queuePersistMessage()` 这三步是"添加一条消息"的标准操作，应该封装为 `history.appendMessage(accountId, conversationId, userMessage)`。

**`heartbeat/evaluator.ts` 对 `prompts/` 模块**：

```typescript
// evaluator.ts:278-293 —— Phase 2 prompt 组装逻辑在 evaluator 中
const assets = getPromptAssets();
const execTemplate = assets.get(PROMPT_TEMPLATES.heartbeat_exec);
const phase2Prompt = renderTemplate(execTemplate, { goalId, description, context, reason, recentSection }, { strict: true });
```

Prompt 模板的获取和渲染散落在 `evaluator.ts`、`vision.ts`（line 319）、`assembler.ts` 三处。应统一到 prompts 模块提供高层函数。

### 🟡 不恰当的亲密关系（Inappropriate Intimacy）

**`runner.ts` 与 `skill-runtime.ts`**：

```typescript
// runner.ts:231-234 —— runner 知道 skillRuntime 需要 "从历史恢复已加载技能"
const skillRuntime = createConversationSkillRuntime({
  registry: skills,
  maxOnDemandSkills: config.maxOnDemandSkills,
  initiallyLoadedSkills: collectLoadedSkillNames(workingHistory),
});
```

Runner 知道 Skill 的"加载历史"概念，并调用 `collectLoadedSkillNames()` 来恢复状态。这是跨模块的实现细节泄露 —— `createConversationSkillRuntime` 应该自己从历史中提取已加载的技能名。

---

## 十三、总结评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **函数长度** | 4/10 | chat() 187 行、run() 234 行、createStdioMcpClient() 270 行严重超标 |
| **参数数量** | 6/10 | fireExtractAndRecord 6 参数；accountId+conversationId 数据泥团 |
| **SRP** | 4/10 | 核心函数承担 5-8 个职责，边界模糊 |
| **DRY** | 6/10 | JSON 解析重复、超时模式重复、adapter 结构重复 |
| **命名** | 7/10 | 大部分命名准确；少数魔法字符串应常量化 |
| **注释质量** | 7/10 | 关键决策有注释；有冗余代码翻译式注释和 ASCII 分隔线噪声 |
| **嵌套深度** | 5/10 | runner.ts 最深 6 层，主要因 withSpan callback 模式 |
| **Switch 坏味道** | 6/10 | evaluator、fold、context-window 有条件分发待策略化 |
| **全局状态** | 符合场景 | 已校准：不影响生产正确性，仅影响测试隔离 |
| **整洁架构分层** | 7/10 | 端口层完美；node-cron 跨层依赖、几个跨模块实现知识泄露 |

| **综合评分** | **5.8/10** |
|-------------|-----------|

---

## 十四、优先清理建议

### 🔴 高优先级（严重影响可读性和可维护性）

| # | 问题 | 位置 | 建议手法 | 工作量 |
|---|------|------|---------|--------|
| 1 | `chat()` 187 行单一函数 | `chat.ts:82-269` | Extract Function × 5：`loadContext`、`buildUserMessage`、`persistUserMessage`、`handleRunResult`、`finalizeReply` | 1d |
| 2 | `run()` 234 行内嵌循环 | `runner.ts:209-443` | Extract Function × 4：`trimContext`、`buildTools`、`invokeLLM`、`executeToolCalls` | 1d |
| 3 | `use_skill` 特殊处理 | `runner.ts:386-392` | 将 `use_skill` 注册为普通 ToolRegistry 工具，消除 runner 中的内联分支 | 0.5d |
| 4 | `accountId + conversationId` 数据泥团 | 全局 ~30 处 | 引入 `ConversationRef` 值对象，渐进替换 | 0.5d |

### 🟡 中优先级（消除重复和坏味道）

| # | 问题 | 位置 | 建议手法 | 工作量 |
|---|------|------|---------|--------|
| 5 | JSON 解析 fallback 重复 | `evaluator.ts` + `vision.ts` | Extract Function → 通用 `extractJsonBlock()` | 0.5d |
| 6 | `Promise.race` 超时模式重复 | `executor.ts:38-60` | Extract Function → `withTimeout(fn, ms)` | 0.5d |
| 7 | `createStdioMcpClient` 270 行 | `mcp/stdio-client.ts:167-437` | 拆分为 `McpConnection`、`McpRequestQueue`、`McpProtocolHandler` 类 | 1.5d |
| 8 | `runtime-provisioner.ts` 516 行 | `skills/runtime-provisioner.ts` | 按 runtime 拆分文件：`python-adapter.ts`、`node-adapter.ts` | 0.5d |
| 9 | `executeTask()` 多路径 | `scheduler/executor.ts:20-124` | 提取 `executePromptTask()` + `executeHandlerTask()`，Strategy 模式 | 0.5d |

### 🟢 低优先级（锦上添花）

| # | 问题 | 位置 | 建议手法 | 工作量 |
|---|------|------|---------|--------|
| 10 | 魔法字符串常量化 | 多处 | 提取 `GLOBAL_BRANCH`、`TaskKind` 等常量 | 0.5d |
| 11 | verdict switch → Strategy map | `heartbeat/evaluator.ts:260-309` | 映射表替代 if/else if | 0.5d |
| 12 | 三级裁剪 → 责任链 | `context-window.ts:158-241` | TrimStrategy 接口 + Chain | 0.5d |
| 13 | 冗余注释清理 | `runner.ts`, `tape/service.ts` | 删除代码翻译式注释和 ASCII 分隔线 | 0.5d |
| 14 | `fold()` category switch → Strategy | `tape/fold.ts` | 映射表替代 switch | 0.5d |

---

## 十五、结语

从整洁代码三书的视角来看，`@clawbot/agent` 的**架构分层（Clean Architecture）表现最好** — 端口接口的依赖反转严格执行，领域逻辑与框架隔离良好。**代码整洁度（Clean Code）有明确的欠账** — 核心路径上存在 180+ 行的"上帝函数"、234 行的内嵌循环、以及散布在多个文件中的重复模式。**重构空间（Refactoring）集中在** — `chat()` 和 `run()` 的方法提取、`accountId/conversationId` 数据泥团的消除、以及几个关键条件分发逻辑的策略化。

好消息是这些问题都可以**渐进式修复** — 每次提取一个子函数，不改变外部行为，不增加风险，遵循童子军规则（"让营地比你发现时更干净"）。高优先级 4 项总计约 **3 个工作日**，可带来立竿见影的可读性改善；全部 14 项约 **8 个工作日**。
