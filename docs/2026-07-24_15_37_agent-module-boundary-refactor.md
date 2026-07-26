# @clawbot/agent 模块边界重构方案（2026-07-24）

> 承接 [2026-07-02 架构评审](./2026-07-02_18_45_architecture-review-20260702.md) E 节「模块边界（agent 包内）」与 D 节阶段 3 的第 1、2 项。

## 一、背景

评审 E 节给出了 agent 包的目标模块边界：`engine/` / `capabilities/` / `memory/` / `ports/`，核心诉求是「一次 run 是一个携带 `RunContext` 的执行体，所有工具/技能/记忆通过 ctx 取上下文，**零模块级可变状态**」。

现状：

- `packages/agent/src` 98 个文件、13.4k 行，11 个目录平铺在 `src/` 下，`runner.ts` / `chat.ts` / `model-resolver.ts` / `vision.ts` / `media.ts` 还散落在包根目录。
- 评审阶段 1 的 C1（工具上下文跨账号污染）与 C5（AbortSignal 透传）已经落地——`ToolContext` 现在通过 `runner.run(..., toolContext)` 参数传递，`runtime/agent-tool-context.ts` 已经不是模块级 slot 而是纯读取函数。
- 剩下的结构问题是：模块划分没有形成分层，`engine` 层仍有大量模块级可变状态（`conversation/history.ts` 的 5 个 Map、`chat.ts` 的 `_deps`、`commands/debug.ts` 的 debugState），并且存在 4 条反向依赖边。

### 本次范围

| | 内容 |
|---|---|
| **做** | 物理模块重组 + 引擎去全局化（`RunContext` 贯穿、`ConversationCache` / `ChatEngine` 可实例化） |
| **不做** | H2 账号级工具权限过滤、H1 消息持久化分队列、C4 密钥加密、H5 `server/agent.ts` 职责拆分 |
| **对外 API** | `@clawbot/agent` 子路径导出的 key 全部保持不变，只改 `package.json` 中 exports 的 value 指向新目录，server 侧 import 说明符零改动 |

---

## 二、目标结构

现有目录之间存在 4 条需要处理的反向依赖边，重组后用分层规则固化：

```
src/
├── index.ts                    公共 barrel（导出面基本不变）
│
├── engine/                     L5 编排层：一次 run 的执行体
│   ├── context.ts              RunContext + toolContextFrom()
│   ├── chat-engine.ts          createChatEngine() → ChatEngine
│   ├── turn.ts                 （原 chat.ts 的编排体，engine 内部）
│   ├── runner.ts               （原 src/runner.ts）
│   ├── system-prompt.ts        assembleSystemPrompt()（从 prompts/ 上提，见 2.1）
│   ├── conversation/
│   │   ├── cache.ts            （原 history.ts → ConversationCache 实例）
│   │   ├── context-window.ts
│   │   └── title.ts
│   └── index.ts
│
├── capabilities/               L4 能力层
│   ├── tools/                  registry / composite-registry / define-tool / builtins /
│   │                           types / context.ts（原 runtime/agent-tool-context.ts）
│   │                           handlers/{cli,web-fetch,web-search}
│   ├── skills/                 14 个文件原样 + conversation-runtime.ts（原 runtime/skill-runtime.ts）
│   ├── mcp/                    stdio-client / tool-adapter / types
│   ├── scheduler/              manager / executor / tool / command / constants / types
│   └── heartbeat/              engine / evaluator / reason-internal / tool / types
│
├── memory/                     L3（原 tape/，内部文件名不变）
│
├── llm/                        L2 LLM 适配 + 配置解析
│   ├── types / messages / model-meta / provider-factory
│   ├── model-resolver.ts       （原 src/model-resolver.ts）
│   ├── token-estimator.ts      （原 conversation/token-estimator.ts）
│   └── vision.ts               （原 src/vision.ts）
│
├── prompts/                    L2（去掉对 skills 的依赖，见 2.1）
├── commands/                   L2 registry / types / builtins
├── ports/                      L1（不动，新增 chat-executor.ts）
└── shared/                     L0 errors / types / media / utils/
```

**分层规则**：只能向下依赖（L5 → L4 → L3 → L2 → L1 → L0）。同层内部再定序：`prompts < llm`，`tools < skills / mcp / scheduler / heartbeat`。

> 注：`shared/` 是包内目录，与 `@clawbot/shared` 包无关，import 时通过 `../shared/xxx.js` 与 `@clawbot/shared` 区分。

### 2.1 重组时必须切断的 4 条反向边

| # | 现状 | 处理方式 |
|---|------|---------|
| 1 | `prompts/assembler.ts:10` → `skills/types.js`（`assembleSystemPrompt` 的 `SkillRegistry` 参数） | 把 `assembleSystemPrompt()` 整个搬到 `engine/system-prompt.ts`，唯一调用方是 `runner.ts:443`。`prompts/` 剩下 `renderTemplate` / `assembleUserContext` / loader / port / profiles，变成零依赖模块 |
| 2 | `tools/define-tool.ts:3` → `runtime/agent-tool-context.js`（`isToolContextMissingError`） | `runtime/` 目录解散：`agent-tool-context.ts` 并入 `capabilities/tools/context.ts`，`skill-runtime.ts` 并入 `capabilities/skills/conversation-runtime.ts` |
| 3 | `tape/service.ts:7` → `conversation/token-estimator.js` | `token-estimator.ts` 下沉到 `llm/`（runner 与 tape 都依赖它） |
| 4 | `scheduler/executor.ts:1,4` → `chat.js` + `conversation/history.js` | 唯一的真正架构违规，用新的 `ChatExecutorPort` 解决（见 3.4） |

---

## 三、实施阶段

### Stage A：物理重组（纯搬移，行为不变）

用 `git mv` 逐模块搬移以保留文件历史，之后靠 `tsc --noEmit` 的报错驱动修 import 路径。

1. `git mv` 建立新目录，按第二节的表搬文件。
2. 改写相对 import（本包全部使用 `.js` 扩展名，跨目录路径需同步调整）。
3. `src/index.ts` barrel 的 import 路径更新，**导出的符号一个不删**。
4. `package.json` 的 `exports` 只改 value：

   | key（不变） | value 新指向 |
   |---|---|
   | `./tape` | `./src/memory/index.ts` |
   | `./conversation` | `./src/engine/conversation/index.ts` |
   | `./chat` | `./src/engine/index.ts` |
   | `./model-resolver` | `./src/llm/model-resolver.ts` |
   | `./media` | `./src/shared/media.ts` |
   | `./tools/*`、`./skills/*`、`./mcp/*` | `./src/capabilities/...` |
   | `./ports`、`./prompts`、`./llm`、`./commands`、`./scheduler` | 相应新路径 |

5. `test/` 下 20 个测试文件的 import 路径同步更新，目录结构镜像 `src/`。

**验收**：agent / server 双包 `tsc --noEmit` 与 `pnpm test:agent` 全绿，**server 侧 diff 为空**。单独一次提交。

### Stage B：引擎去全局化

#### B1. RunContext（`engine/context.ts`）

`RunKind` / `ToolContext` 保留在 `capabilities/tools/types.ts` 不动（engine → capabilities 是合法的向下依赖）。

```ts
export interface RunContext {
  accountId: string;
  conversationId: string;         // 执行会话：history / memory / trace 归属
  targetConversationId?: string;  // 工具可见 & 推送目标会话，默认同上
  runKind: RunKind;
  signal?: AbortSignal;
  logger?: Logger;
}

export function toolContextFrom(ctx: RunContext, signal: AbortSignal): ToolContext;
```

这一步把现在 `chat()` 的 6 个位置参数 + `options.toolContext` 收敛成一个 ctx。

评审「决策 2」的不对称语义——scheduled run 中 `conversationId = scheduler:{seq}`（执行会话）而 `targetConversationId = task.conversationId`（推送目标与新任务归属）——由 `targetConversationId` 显式承载，现有 `scheduler/tool.ts:92` 的 `ctx.targetConversationId ?? ctx.conversationId` 语义完全保留，**不要在重构中"顺手统一"这两个 ID**。

#### B2. ConversationCache（`engine/conversation/cache.ts`）

`history.ts` 的 5 个模块级 Map（`store` / `seqCounters` / `loading` / `waitQueues` / `lruOrder`）收进实例：

```ts
export interface ConversationCache {
  ensureLoaded(accountId, conversationId): Promise<AgentMessage[]>;
  get(accountId, conversationId): AgentMessage[];
  nextSeq(accountId, conversationId): number;
  currentSeq(accountId, conversationId): number;
  evict(accountId, conversationId): void;
  clear(accountId, conversationId): void;
  rollback(accountId, conversationId, count): Promise<void>;
  appendAssistantText(accountId, conversationId, text): Promise<void>;
  withLock<T>(accountId, conversationId, fn: () => Promise<T>): Promise<T>;
}

export function createConversationCache(opts?: {
  maxCachedConversations?: number;  // 默认 500，沿用现值
  lockTimeoutMs?: number;           // 默认 30_000
}): ConversationCache;
```

锁 / LRU / seq 分配的算法逐行照搬，只做实例化改造。`conversation/title.ts:77` 的 `getHistory` 调用改为接收 cache。

#### B3. ChatEngine（`engine/chat-engine.ts`）

消灭 `chat.ts:84` 的 `let _deps` 与 `setChatDeps()`：

```ts
export interface ChatEngine {
  readonly conversations: ConversationCache;
  readonly debugFlags: DebugFlags;
  chat(ctx: RunContext, input: {
    text: string;
    media?: ChatMedia;
    startedAt?: number;
  }): Promise<ChatResponse>;
  generateConversationTitle(
    ctx: RunContext,
    turn: { userText: string; assistantText: string },
  ): Promise<string | null>;
}

export function createChatEngine(deps: {
  runner: AgentRunner;
  log: ChatLog;
  conversations?: ConversationCache;  // 默认 createConversationCache()
  debugFlags?: DebugFlags;
}): ChatEngine;
```

`chat.ts` 的内部辅助函数（`loadConversationContext` / `buildUserMessage` / `createMessageTracker` / `handleRunResult` / `scheduleMemoryExtraction`）搬进 `engine/turn.ts`，签名从散装的 `(accountId, conversationId, ...)` 改为 `(ctx, cache, ...)`。

#### B4. ChatExecutorPort（`ports/chat-executor.ts`）—— 切断 capabilities → engine

`capabilities/scheduler/executor.ts` 直接 import `chat` 与 `withConversationLock`，是唯一的向上依赖。heartbeat 早已通过 `HeartbeatExecutorPort` 走对了路，把它泛化成统一 port：

```ts
export interface ChatExecutionRequest {
  accountId: string;
  conversationId: string;
  targetConversationId?: string;
  prompt: string;
  runKind: RunKind;
  signal?: AbortSignal;
}
export interface ChatExecutionResult {
  text?: string;
  status: "completed" | "error";
  error?: string;
}
export interface ChatExecutorPort {
  execute(req: ChatExecutionRequest): Promise<ChatExecutionResult>;
}
```

- 删除 `ports/heartbeat-executor.ts`，`heartbeat/engine.ts` 改调 `getChatExecutor()`（`runKind: "heartbeat"`）。
- `scheduler/executor.ts` 改调 `getChatExecutor()`；`AbortController` + 60s 超时逻辑留在 scheduler 侧，通过 `signal` 传入；`withConversationLock` 由 port 实现方负责。
- server 侧 `db/heartbeat-executor.impl.ts` → `db/chat-executor.impl.ts`，一份实现同时服务 scheduler 与 heartbeat 两条路径，统一用 `chatEngine.conversations.withLock` 加锁。

#### B5. DebugFlags（`commands/debug.ts`）

`debugState` Map → `createDebugFlags()` 实例；`debugCommand` 改为 `createDebugCommand(flags)`，`builtinCommands` 改为 `createBuiltinCommands({ debugFlags })`。engine 从 `deps.debugFlags` 读取，`turn.ts` 的 `finalizeReply` 不再 import 全局。

#### B6. server 侧接线

- **`packages/server/src/ai.ts`**：`setChatDeps({...})` → `export const chatEngine = createChatEngine({ runner, log })`；`setChatExecutor(createChatExecutor(chatEngine))` 取代 `setHeartbeatExecutor(...)`。
  顺带把 `setScheduledTaskHandler(rssTaskHandler)` 从 `ai.ts` 挪到 `index.ts` 启动流程——当前 `ai.ts → api/routes/rss.ts` 这条边会挡住路由文件反向 import `ai.ts`。
- **`packages/server/src/agent.ts`**：`chat(...)` → `chatEngine.chat(ctx, {...})`；`withConversationLock` / `clearConversation` / `currentSeq` / `generateConversationTitle` 改走 `chatEngine.conversations.*`。
  **`createAgent` 的职责拆分（评审 H5）本次不做**，只做调用点替换，避免两件事混在同一个 diff 里。
- **`packages/server/src/index.ts`**：`commandRegistry` 注册 `createBuiltinCommands({ debugFlags: chatEngine.debugFlags })`。

#### B7. 保留为进程级单例（不在本次消灭）

评审 F.1 明确「单进程假设写清楚比消除假设便宜两个数量级」。以下是真正具备进程级生命周期的对象，**保留模块级状态并在文档中显式标注为"允许"**：

| 位置 | 状态 | 保留理由 |
|---|---|---|
| `llm/model-resolver.ts` | 配置读缓存 | 纯读缓存 + 已有显式 `invalidateModelCache()`，无跨账号污染风险 |
| `memory/queue.ts` | tape 写队列 | 进程级异步写队列，属 H1 议题范围 |
| `capabilities/heartbeat/engine.ts` | tick 定时器 / inflight / accountQueues | 进程级轮询器 |
| `capabilities/scheduler/manager.ts` | cron job 表 | 进程级 cron 注册表 |

本次的硬性目标是：**`engine/` 目录零模块级可变状态**。

### Stage D：护栏与文档

1. **分层 lint**：新增 `packages/agent/scripts/check-layers.mjs` 与 `lint:layers` script，扫描 `src/**/*.ts` 的相对 import，违反分层规则即非零退出。参照 `packages/web` 已有的 `lint:arbitrary` 脚本风格——用工具而非公约执行规范，是本仓库既有做法。
2. **补测试**（去全局化后这些第一次变得可测）：
   - `test/engine/conversation/cache.test.ts`：锁串行性、seq 单调递增、LRU 淘汰、rollback 越界
   - `test/engine/chat-engine.test.ts`：假 runner + 假 MessageStore，覆盖 happy path / error 回滚 / max_rounds
   - `test/capabilities/scheduler/executor.test.ts`：假 `ChatExecutorPort`，验证超时 abort 与 `targetConversationId` 归属语义
3. **文档**：
   - 更新 `packages/agent/AGENTS.md` 的目录结构与依赖方向章节
   - 更新根 `AGENTS.md` 的 Monorepo 结构表
   - 在 `docs/2026-04-01_17_39_agent-architecture.md` 补「模块分层 + 允许的进程级单例 + 单进程假设」一节（评审 M1）
   - 在架构评审文档末尾追加实施记录

---

## 四、验证

```bash
# 每个 Stage 结束都跑
pnpm -F @clawbot/agent exec tsc --noEmit
pnpm -F @clawbot/agent exec tsc --noEmit -p test/tsconfig.json
pnpm -F @clawbot/server exec tsc --noEmit
pnpm test:agent && pnpm test:server
pnpm -F @clawbot/agent lint:layers   # Stage D 之后
pnpm build                            # 确认 dist 产物路径与 exports 一致
```

端到端（Stage B 后必须做，纯类型检查覆盖不到运行时接线）：

1. `pnpm dev` → 发一条微信消息，确认正常回复、DB `messages` 表有记录。
2. `/debug` 开关 → 确认回复尾部出现耗时行（验证 DebugFlags 接线）。
3. `/reset` → 确认会话轮转 + handoff anchor 生成（验证 `conversations.evict/clear`）。
4. 建一个 1 分钟的定时任务 → 确认按时执行且推送到**原始会话**而非 `scheduler:{seq}`（验证 B4 未丢失 `targetConversationId` 语义）。
5. 触发一个 heartbeat 目标至 `act` → 确认走通新的 `ChatExecutorPort`。
6. Web 后台修改模型配置 → 确认 `invalidateModelCache` 生效、下一条消息使用新模型。

## 五、提交划分

| commit | 内容 |
|---|---|
| 1 | Stage A 纯搬移（server diff 为空） |
| 2 | Stage B1–B5 agent 侧引擎实例化 |
| 3 | Stage B6 server 侧接线 |
| 4 | Stage D 护栏 + 测试 + 文档 |
