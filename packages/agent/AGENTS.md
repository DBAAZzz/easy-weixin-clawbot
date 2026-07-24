# AGENTS.md — @clawbot/agent

> AI 核心引擎：LLM 循环、工具调用、技能注入、MCP 集成、Tape 记忆、定时任务、Heartbeat。

## 角色定位

这是**纯编排层**，所有外部 IO 通过 Port 接口注入。**绝对禁止**在此包中：
- 导入 `@clawbot/server` 或任何 HTTP / Express / Hono 代码
- 直接使用 Prisma Client 或任何数据库驱动
- 直接读写文件系统（通过 Loader 参数传入路径）

## 目录结构与分层

`src/` 按 L5→L0 分层，**只能向下依赖**（同层内部再定序，见下表）：

```
src/
├── index.ts                    # 公共 API barrel export，可以导入任何层
│
├── engine/                     L5 编排层：一次 run 是一个携带 RunContext 的执行体
│   ├── context.ts              # RunContext + toolContextFrom()
│   ├── chat-engine.ts          # createChatEngine() → ChatEngine（可实例化，非全局单例）
│   ├── turn.ts                 # 单轮对话编排：历史→LLM→持久化→记忆提取
│   ├── runner.ts                # createAgentRunner(): LLM tool-use 循环
│   ├── system-prompt.ts        # assembleSystemPrompt()（依赖 skills，故从 prompts/ 独立出来）
│   ├── index.ts                # 子路径导出：ChatEngine / RunContext
│   └── conversation/
│       ├── cache.ts            # createConversationCache() → ConversationCache（可实例化）
│       ├── context-window.ts   # fitToContextWindow()
│       └── title.ts            # generateConversationTitle()
│
├── capabilities/                L4 能力层（tools 是 capabilities 内部的基础子层，其余四个可以依赖 tools，tools 不能反向依赖它们）
│   ├── tools/                  # 工具 Registry + Compiler + Loader + Installer + AgentToolContext
│   ├── skills/                 # 技能 Registry + Compiler + Loader + Installer + ConversationSkillRuntime
│   ├── mcp/                    # MCP stdio 客户端 + 工具适配
│   ├── scheduler/              # Cron 任务管理，通过 ChatExecutorPort 执行任务，不直接依赖 engine
│   └── heartbeat/              # 异步目标检查（Phase1 评估 + Phase2 通过 ChatExecutorPort 执行）
│
├── memory/                     L3 Tape 记忆：fold reducer + LLM 提取 + 压缩（原 tape/）
│
├── llm/                        L2 LLM 适配层（可以依赖 prompts，prompts 不能依赖 llm）
│   ├── types.ts                # 内部消息类型（与 AI SDK 解耦）
│   ├── messages.ts             # agentToModelMessages() 双向转换
│   ├── model-meta.ts / provider-factory.ts
│   ├── model-resolver.ts       # 三级配置解析（conversation → account → global）
│   ├── token-estimator.ts
│   └── vision.ts
├── prompts/                    L2 Prompt 模板 + Profile 组装（不依赖 skills，assembleSystemPrompt 在 engine/ 里）
├── commands/                   L2 内置命令 (/reset /echo /debug /help)，与 llm/prompts 相互独立
│
├── ports/                      L1 Port 接口（DI 边界，不动）
├── shared/                     L0 errors / types / media / utils/（原包根 + utils/）
└── test/                       测试 fixtures + helpers（不参与分层检查）
```

`pnpm -F @clawbot/agent lint:layers`（`scripts/check-layers.mjs`）用工具而非公约执行上表的分层规则：扫描 `src/**/*.ts` 的相对 import，任何**值导入**（非 `import type`）指向更高层即非零退出。`import type` 不受限——跨层的纯类型引用（如 `RunKind`、`AgentMessage`）不产生运行时依赖，予以豁免。

## 核心模式

### RunContext（一次 run 的执行体）

```ts
interface RunContext {
  accountId: string;
  conversationId: string;         // 执行会话：history / memory / trace 归属
  targetConversationId?: string;  // 工具可见 & 推送目标会话，默认同上
  runKind: "chat" | "scheduler" | "heartbeat";
  signal?: AbortSignal;
  logger?: Logger;
}
```

`conversationId` 与 `targetConversationId` 语义不对称：定时任务在隔离会话 `scheduler:{seq}` 中执行（`conversationId`），但结果推送、新建 goal 归属用户真实会话（`targetConversationId`）。**这两个 ID 永远不要"顺手统一"**，`scheduler/tool.ts` 里 `ctx.targetConversationId ?? ctx.conversationId` 的写法就是依赖这个区分。

### ChatEngine / ConversationCache（可实例化，零模块级可变状态）

`engine/` 目录内没有模块级可变状态——`ConversationCache`（原 5 个模块级 Map）、`ChatEngine`（原 `chat.ts` 的 `_deps`/`setChatDeps`）、`DebugFlags`（原 `commands/debug.ts` 的 `debugState` Map）都是 `createXxx()` 工厂返回的实例。`server` 侧只创建一份（`packages/server/src/ai.ts` 的 `chatEngine`），但**多实例可以并存**，这是测试可以直接 `createChatEngine({ runner, log })` 而不需要全局 mock 的原因（见 `test/engine/`）。

```ts
const chatEngine = createChatEngine({ runner, log });
await chatEngine.chat(ctx, { text, media, startedAt });
await chatEngine.generateConversationTitle(ctx, { userText, assistantText });
chatEngine.conversations.withLock(accountId, conversationId, fn);
```

### AgentRunner（LLM 循环）

```
LLM.complete() → assistant message (text 或 tool_calls)
  ↓ 若有 tool_calls → 并行执行（timeout 30s）
  ↓ 添加 tool results 到历史
  ↓ 重复直到 LLM 返回纯文本 或达到 maxRounds（默认 10）
```

### Port/Adapter（依赖注入）

Port 定义在 `ports/`，由 `server` 包在启动时注入实现：

| Port | 职责 |
|------|------|
| `MessageStore` | 消息持久化、回滚、历史恢复 |
| `TapeStore` | Tape 条目/锚点 CRUD、压缩、分支查询 |
| `PushService` | 主动推送消息（微信） |
| `SchedulerStore` | 定时任务 + 运行记录 CRUD |
| `ModelConfigStore` | LLM Provider 模板 + 作用域配置 |
| `HeartbeatStore` | 异步目标 CRUD + 状态机 |
| `ChatExecutorPort` | 在 `capabilities/`（scheduler、heartbeat）内发起一次完整 `chat()`，由 `server` 提供加锁实现；取代了原来 scheduler 专属的、直接 import `engine/chat.ts` 的反向依赖 |

**添加新外部依赖时**，必须定义 Port 接口，在 `server` 侧实现。

LLM 运行时配置只来自 `ModelConfigStore` 注入的数据库配置；`agent` 包内不得重新引入环境变量回退。

### Registry + Installer 模式

工具和技能共享同一模式：
```
Markdown 文件 → parse(YAML + body) → CompiledTool/Skill
  ↓
Loader（从 builtin/ + user/ 加载）→ Registry.swap(snapshot)
  ↓
Installer（CRUD 用户自定义）→ 重新触发 Loader → swap
```

### Tape 记忆 Reducer

```
TapeState = fold(lastAnchor.snapshot, newEntries[])
entries = extract(对话历史) via LLM  →  facts | preferences | decisions
当条目超过阈值 → compact → 新 Anchor
```

分支策略：`__global__`（跨会话持久）、`{conversationId}`（会话临时）

### Heartbeat 两阶段

```
Phase1: 找到到期目标 → LLM 评估 → Verdict {act|wait|resolve|abandon}
Phase2: verdict == act → 通过 ChatExecutorPort 执行 chat()
```

### 允许的进程级单例

以下对象具备真实的进程级生命周期，**保留模块级状态是有意为之**，不在 `engine/` 零状态目标之内（`engine/` 之外）：

| 位置 | 状态 | 保留理由 |
|---|---|---|
| `llm/model-resolver.ts` | 配置读缓存 | 纯读缓存 + 显式 `invalidateModelCache()`，无跨账号污染风险 |
| `memory/queue.ts` | tape 写队列 | 进程级异步写队列 |
| `capabilities/heartbeat/engine.ts` | tick 定时器 / inflight / accountQueues | 进程级轮询器 |
| `capabilities/scheduler/manager.ts` | cron job 表 | 进程级 cron 注册表 |

单进程假设写清楚比消除假设便宜两个数量级——不要为了"更纯粹"去重构这四处。

## 测试

```bash
pnpm test:agent
# 等同于 tsx --conditions development --test 'test/**/*.test.ts'

pnpm -F @clawbot/agent typecheck
# 依次检查 tsconfig.json（src）与 test/tsconfig.json（test）

pnpm -F @clawbot/agent lint:layers
# scripts/check-layers.mjs，检查上面的分层规则
```

测试文件全部放在 `test/`，目录结构镜像 `src/`，命名 `*.test.ts`。使用 Node.js 原生 test runner。

- `src/engine/conversation/cache.ts` → `test/engine/conversation/cache.test.ts`
- 测试用相对路径 import 源码（`../../src/memory/service.js`），可以访问包内部模块，不限于 `index.ts` 的公开导出
- 两个 tsconfig 分工：根 `tsconfig.json` 是 composite 构建配置（只 include `src`，所以测试不会进 `dist/`，且被 `packages/server` 的 project reference 引用）；`test/tsconfig.json` 是测试项目配置，`noEmit`，编辑器靠它给 `test/` 下的文件提供正确的编译选项——名字必须是 `tsconfig.json`，否则 VSCode 不会发现它，`node:*` 模块会误报 TS2307

## 修改指南

- 新增工具处理器 → `src/capabilities/tools/handlers/`，并在 handler index 注册
- 新增内置命令 → `src/commands/`，在 `builtins.ts` 的 `createBuiltinCommands()` 里注册
- 新增 Port → `src/ports/` 定义接口，`ports/index.ts` 添加 getter/setter
- 修改 Prompt → `prompts/*.md` 模板，`src/prompts/assembler.ts`（用户上下文）或 `src/engine/system-prompt.ts`（system prompt，需要 skills）组装逻辑
- 新增 LLM Provider → `src/llm/provider-factory.ts`
- 修改后先跑 `pnpm -F @clawbot/agent lint:layers`，再跑 `typecheck` 和 `test`
