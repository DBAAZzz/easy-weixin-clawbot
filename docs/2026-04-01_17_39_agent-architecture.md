# Agent Architecture — MVP

> 将 agent 能力层从 server 中独立，基于 pi-ai 编排，支持 async 工具执行和 Skill 插件化注册。

## 目标

解决当前核心问题：**工具系统是同步的且几乎为空**。其余能力（MCP、context 管理、多 agent 路由）留待后续迭代。

## 结构

```text
packages/
├── agent/                    # 新增：纯 agent 能力层
│   ├── src/
│   │   ├── index.ts          — 公共导出
│   │   ├── runner.ts         — AgentRunner：async tool-use loop
│   │   └── skills/
│   │       ├── registry.ts   — SkillRegistry
│   │       ├── types.ts      — Skill 接口
│   │       ├── time.ts       — get_current_time
│   │       └── web-search.ts — web_search
│   ├── package.json
│   └── tsconfig.json
├── server/                   # 瘦化：去掉 ai.ts 中的 tool loop
├── web/
└── shared/
```

## 核心接口

### AgentRunner

```typescript
// packages/agent/src/runner.ts
import {
  complete,
  type Model,
  type Message,
  type AssistantMessage,
  type ToolResultMessage,
  type Tool,
  type Context,
} from "@mariozechner/pi-ai";
import type { SkillRegistry } from "./skills/registry.js";

export interface AgentConfig {
  model: Model<any>;
  systemPrompt: string;
  apiKey?: string;
  maxRounds?: number;       // 默认 10
  toolTimeoutMs?: number;   // 默认 30_000
}

export interface RunCallbacks {
  /** 每条 assistant/toolResult 产出时立即调用，用于增量持久化 */
  onMessage(msg: Message): void;
}

export type RunResult =
  | { status: "completed"; finalMessage: AssistantMessage }
  | { status: "max_rounds"; lastMessage: AssistantMessage; rounds: number }
  | { status: "aborted" };

export interface AgentRunner {
  run(
    messages: Message[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
  ): Promise<RunResult>;
}

export function createAgentRunner(
  config: AgentConfig,
  skills: SkillRegistry,
): AgentRunner {

  async function run(
    messages: Message[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    const tools = skills.getTools();
    const maxRounds = config.maxRounds ?? 10;
    const workingHistory = [...messages];

    for (let round = 1; round <= maxRounds; round++) {
      if (signal?.aborted) return { status: "aborted" };

      const response = await complete(
        config.model,
        { systemPrompt: config.systemPrompt, messages: workingHistory, tools },
        { apiKey: config.apiKey, signal },
      );

      workingHistory.push(response);
      callbacks.onMessage(response);

      if (response.stopReason !== "toolUse") {
        return { status: "completed", finalMessage: response };
      }

      for (const block of response.content) {
        if (block.type !== "toolCall") continue;

        const timeout = config.toolTimeoutMs ?? 30_000;
        const toolSignal = AbortSignal.any([
          signal ?? new AbortController().signal,
          AbortSignal.timeout(timeout),
        ]);

        const result = await skills.execute(block.id, block.name, block.arguments, toolSignal);
        workingHistory.push(result);
        callbacks.onMessage(result);
      }
    }

    const last = workingHistory
      .filter((m): m is AssistantMessage => m.role === "assistant")
      .at(-1)!;
    return { status: "max_rounds", lastMessage: last, rounds: maxRounds };
  }

  return { run };
}
```

### Skill

```typescript
// packages/agent/src/skills/types.ts
import type { Tool, TextContent, ImageContent } from "@mariozechner/pi-ai";

export interface SkillContext {
  signal: AbortSignal;
}

export type SkillContent = TextContent | ImageContent;

export interface Skill {
  tool: Tool;
  execute(args: Record<string, unknown>, ctx: SkillContext): Promise<SkillContent[]>;
}
```

### SkillRegistry

```typescript
// packages/agent/src/skills/registry.ts
import type { Tool, ToolResultMessage } from "@mariozechner/pi-ai";
import type { Skill, SkillContext } from "./types.js";

export interface SkillRegistry {
  register(skill: Skill): void;
  getTools(): Tool[];
  execute(
    callId: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<ToolResultMessage>;
}

export function createSkillRegistry(): SkillRegistry {
  const skills = new Map<string, Skill>();

  return {
    register(skill) { skills.set(skill.tool.name, skill); },
    getTools() { return [...skills.values()].map((s) => s.tool); },

    async execute(callId, name, args, signal) {
      const skill = skills.get(name);
      const ctx: SkillContext = { signal };

      if (!skill) {
        return {
          role: "toolResult" as const, toolCallId: callId, toolName: name,
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true, timestamp: Date.now(),
        };
      }

      try {
        const content = await skill.execute(args, ctx);
        return {
          role: "toolResult" as const, toolCallId: callId, toolName: name,
          content, isError: false, timestamp: Date.now(),
        };
      } catch (err) {
        return {
          role: "toolResult" as const, toolCallId: callId, toolName: name,
          content: [{ type: "text" as const, text: String(err) }],
          isError: true, timestamp: Date.now(),
        };
      }
    },
  };
}
```

## Server 接入

```typescript
// packages/server/src/agent.ts
import { createAgentRunner, createSkillRegistry } from "@clawbot/agent";
import { timeSkill } from "@clawbot/agent/skills/time";
import { webSearchSkill } from "@clawbot/agent/skills/web-search";

const skills = createSkillRegistry();
skills.register(timeSkill);
skills.register(webSearchSkill);

const runner = createAgentRunner({ model, systemPrompt, apiKey }, skills);

// Agent.chat() 内：
// 1. 构造 userMsg，push 到 history，持久化
// 2. runner.run(history, { onMessage(msg) { push + 持久化 } })
// 3. switch(result.status) → 提取文本返回
```

## 不做的事（留待后续）

- Context 管理 / overflow 处理 — 微信短对话，当前不会触发
- MCP Bridge — 没有要接的 MCP Server
- Checkpoint / epoch 存储 — 依赖 context 管理
- MessageBuilder 抽取 — 构造逻辑太少，不值得独立
- 多 Agent 路由 — Phase 5
- 工具参数 schema 校验 — 可以加但不阻塞 MVP

---

## 附录：模块分层（2026-07-24 重构后）

> 上面的正文是 MVP 阶段（pi-ai 时代）的原始设计记录，保留作历史参照。实际实现早已迁移到 AI SDK 6，
> 并在 [2026-07-24 模块边界重构](./2026-07-24_15_37_agent-module-boundary-refactor.md) 后有了明确的物理分层。
> 当前目录结构、Port 列表、核心模式见 [packages/agent/AGENTS.md](../packages/agent/AGENTS.md)——那份文档随代码演进，是唯一权威来源；这里只补三件正文没有的事：分层规则、允许的进程级单例、单进程假设。

### 模块分层

`src/` 下按 L5→L0 分层，规则是**只能向下依赖**：

```
L5 engine          一次 run 的执行体（RunContext 贯穿，ConversationCache/ChatEngine 可实例化）
L4 capabilities/*  tools 是能力层内部的基础子层；skills/mcp/scheduler/heartbeat 可以依赖 tools，反过来不行
L3 memory          Tape 记忆
L2 llm / prompts / commands   llm 可以依赖 prompts；prompts 与 commands 互相独立
L1 ports           DI 边界
L0 shared          零依赖工具函数
```

`import type` 不受此规则约束——跨层的纯类型引用（`RunKind`、`AgentMessage` 等）没有运行时依赖，因此允许 `ports` 这类低层 import 高层的类型。`pnpm -F @clawbot/agent lint:layers` 强制执行这条规则，而不是停留在文档约定上。

### 允许的进程级单例

绝大多数模块级可变状态已经收敛成可实例化的工厂（`ConversationCache`、`ChatEngine`、`DebugFlags`），`engine/` 目录内现在没有模块级可变状态。但以下四处**保留**模块级状态，是有意为之而不是遗留：

| 位置 | 状态 | 保留理由 |
|---|---|---|
| `llm/model-resolver.ts` | 配置读缓存 | 纯读缓存 + 显式 `invalidateModelCache()`，无跨账号污染风险 |
| `memory/queue.ts` | tape 写队列 | 进程级异步写队列 |
| `capabilities/heartbeat/engine.ts` | tick 定时器 / inflight / accountQueues | 进程级轮询器 |
| `capabilities/scheduler/manager.ts` | cron job 表 | 进程级 cron 注册表 |

### 单进程假设

这四处单例、以及 `server` 侧只创建一份 `chatEngine` 的事实，都建立在**单进程假设**上：`@clawbot/server` 目前以单进程部署，没有多副本水平扩展。把这个假设写清楚（本节 + `packages/agent/AGENTS.md`）比消除它便宜两个数量级——真要支持多副本，需要把这四处状态迁移到外部存储（Redis / DB 行锁），并把 `ConversationCache`/`ChatEngine` 的单例创建改为按需协调，这不是当前阶段要解的问题。
