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
