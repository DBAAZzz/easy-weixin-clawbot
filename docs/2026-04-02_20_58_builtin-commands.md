# Built-in Command System

> 在 LLM 调用之前拦截 `/` 前缀消息，零 token 消耗，毫秒级响应。可扩展注册，新增命令不改动核心流程。

## 目标

1. 支持 `/reset`、`/echo`、`/debug`、`/help` 等内置命令
2. 命令在 Agent.chat() 入口拦截，不经过 LLM，不消耗 token
3. 注册式架构，新增命令只需添加文件 + 一行注册

## 消息流

```text
WeChat 消息
  ↓
Agent.chat(req)
  ↓
tryDispatch(req.text)
  ├── 命中命令 → Command.execute(ctx) → 直接返回 ChatResponse
  └── 未命中   → withConversationLock → chat(ai.ts) → LLM 处理
```

## 结构

```text
packages/server/src/commands/
  ├── types.ts          # Command / CommandContext 接口（纯类型，零依赖）
  ├── registry.ts       # CommandRegistry 类（纯容器，不 import 任何命令）
  ├── builtins.ts       # 导出 Command[]，所有内置命令在此装配
  ├── reset.ts          # /reset  — 清空当前会话
  ├── echo.ts           # /echo   — 回显 + 通道耗时
  ├── debug.ts          # /debug  — 开关 debug 模式
  └── help.ts           # /help   — 列出所有可用命令
```

**依赖方向（无循环）：**

```text
types.ts          ← 所有命令文件 import
registry.ts       ← builtins.ts import（注册）、agent.ts import（dispatch）
builtins.ts       ← agent.ts import（bootstrap 时调用一次）
各命令文件         ← builtins.ts import
help.ts            不 import registry，通过 CommandContext.commands 拿只读列表
```

## 核心接口

```typescript
// types.ts — 纯类型，零运行时依赖

import type { ChatResponse } from "@clawbot/weixin-agent-sdk";

interface CommandContext {
  /** 当前微信账号 ID */
  accountId: string;
  /** 会话 ID（用户/群） */
  conversationId: string;
  /** 命令后的参数文本，如 /echo hello 中的 "hello" */
  args: string;
  /** 消息到达时间戳，用于耗时统计 */
  startedAt: number;
  /** 所有已注册命令的只读快照（供 /help 使用，避免循环依赖） */
  commands: ReadonlyArray<Pick<Command, "name" | "description">>;
}

interface Command {
  /** 命令名（不含 /），如 "reset" */
  name: string;
  /** 一行描述，用于 /help 展示 */
  description: string;
  /** 执行命令，返回直接发给用户的响应 */
  execute(ctx: CommandContext): Promise<ChatResponse>;
}
```

## Registry（纯容器，不 import 任何命令）

```typescript
// registry.ts — 只依赖 types.ts

import type { Command } from "./types.js";

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(cmd: Command): void {
    this.commands.set(cmd.name, cmd);
  }

  registerAll(cmds: Command[]): void {
    for (const cmd of cmds) this.register(cmd);
  }

  /** 只读快照，注入到 CommandContext.commands */
  list(): ReadonlyArray<Pick<Command, "name" | "description">> {
    return [...this.commands.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }

  /**
   * 尝试将文本匹配为内置命令。
   * 返回 null 表示不是命令，走正常 LLM 流程。
   */
  tryDispatch(text: string): { command: Command; args: string } | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) return null;

    const spaceIdx = trimmed.indexOf(" ");
    const name =
      spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
    const args =
      spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

    const cmd = this.commands.get(name);
    return cmd ? { command: cmd, args } : null;
  }
}
```

## Builtins（命令数组，装配点）

```typescript
// builtins.ts — 唯一 import 所有命令文件的地方

import type { Command } from "./types.js";
import { resetCommand } from "./reset.js";
import { echoCommand } from "./echo.js";
import { debugCommand } from "./debug.js";
import { helpCommand } from "./help.js";

/** 所有内置命令，按需裁剪只需改这个数组 */
export const builtinCommands: Command[] = [
  resetCommand,
  echoCommand,
  debugCommand,
  helpCommand,
];
```

## agent.ts 改动

Bootstrap 在模块顶层做一次，dispatch 在 chat() 入口：

```typescript
import { CommandRegistry } from "./commands/registry.js";
import { builtinCommands } from "./commands/builtins.js";

// ---- Bootstrap（模块加载时执行一次）----
const commandRegistry = new CommandRegistry();
commandRegistry.registerAll(builtinCommands);

// 在 createAgent() 内的 chat() 方法中：
async chat(req: ChatRequest): Promise<ChatResponse> {
  log.recv(accountId, req.conversationId, req.text, req.media?.type);

  // ---- 内置命令拦截（不经过 LLM）----
  const dispatched = commandRegistry.tryDispatch(req.text);
  if (dispatched) {
    const startedAt = Date.now();
    const reply = await dispatched.command.execute({
      accountId,
      conversationId: req.conversationId,
      args: dispatched.args,
      startedAt,
      commands: commandRegistry.list(),
    });
    log.send(accountId, req.conversationId, reply.text ?? "");
    return reply;
  }

  // ---- 正常 LLM 流程 ----
  return withConversationLock(accountId, req.conversationId, async () => {
    // ... 原有逻辑不变
  });
}
```

## 内置命令实现

### /reset — 清空会话

```typescript
// reset.ts
import { clearConversation } from "../conversation.js";
import type { Command } from "./types.js";

export const resetCommand: Command = {
  name: "reset",
  description: "清空当前会话历史，重新开始",
  async execute(ctx) {
    clearConversation(ctx.accountId, ctx.conversationId);
    return { text: "会话已清空，可以重新开始对话了。" };
  },
};
```

### /echo — 回显 + 耗时

```typescript
// echo.ts
import type { Command } from "./types.js";

export const echoCommand: Command = {
  name: "echo",
  description: "直接回显消息，附带通道耗时统计",
  async execute(ctx) {
    const elapsed = Date.now() - ctx.startedAt;
    const text = ctx.args
      ? `${ctx.args}\n\n⏱ 通道耗时: ${elapsed}ms`
      : `(空消息)\n\n⏱ 通道耗时: ${elapsed}ms`;
    return { text };
  },
};
```

### /debug — 开关 debug 模式

```typescript
// debug.ts
import type { Command } from "./types.js";

// 每个会话独立的 debug 开关
const debugState = new Map<string, boolean>();

export function isDebugEnabled(accountId: string, conversationId: string): boolean {
  return debugState.get(`${accountId}::${conversationId}`) ?? false;
}

export const debugCommand: Command = {
  name: "debug",
  description: "开关 debug 模式（启用后每条回复追加全链路耗时）",
  async execute(ctx) {
    const key = `${ctx.accountId}::${ctx.conversationId}`;
    const current = debugState.get(key) ?? false;
    debugState.set(key, !current);
    const status = !current ? "已开启" : "已关闭";
    return { text: `Debug 模式${status}` };
  },
};
```

### /help — 列出命令

```typescript
// help.ts — 不 import registry，从 ctx.commands 读取
import type { Command } from "./types.js";

export const helpCommand: Command = {
  name: "help",
  description: "列出所有可用命令",
  async execute(ctx) {
    const lines = ctx.commands.map(
      (cmd) => `/${cmd.name} — ${cmd.description}`,
    );
    return { text: lines.join("\n") };
  },
};
```

## Debug 模式集成

在 `ai.ts` 的 `finalizeReply` 中，当 debug 开启时追加耗时信息：

```typescript
import { isDebugEnabled } from "./commands/debug.js";

// 在 chat() 函数中记录 startedAt，传到 finalizeReply：
function finalizeReply(
  text: string,
  fallback: string,
  debugInfo?: { enabled: boolean; startedAt: number; rounds: number },
): ChatResponse {
  const raw = text || fallback;
  const { cleanText, media } = extractMediaFromText(raw);

  let finalText = cleanText || undefined;
  if (finalText && debugInfo?.enabled) {
    const elapsed = Date.now() - debugInfo.startedAt;
    finalText += `\n\n---\n⏱ LLM ${debugInfo.rounds} round(s), ${elapsed}ms`;
  }

  const response: ChatResponse = { text: finalText };
  if (media) response.media = media;
  return response;
}
```

## 扩展指南

新增命令只需两步：

1. 创建 `commands/xxx.ts`，导出 `Command` 对象
2. 在 `commands/builtins.ts` 数组中添加

不需要改动 `registry.ts`、`agent.ts`、`ai.ts` 或其他任何文件。

按环境裁剪命令：只需在 `builtins.ts` 中条件过滤数组即可。

## 设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 拦截位置 | Agent.chat() 入口 | 最早拦截，不进锁、不加载历史、不调 LLM |
| 命令前缀 | `/` | 与 weixin-agent-sdk 和业界惯例一致 |
| 注册与定义分离 | registry.ts 纯容器 + builtins.ts 命令数组 + agent.ts bootstrap | 无循环依赖，可测试，可按环境裁剪 |
| /help 获取列表 | 通过 CommandContext.commands 注入 | help.ts 不反向 import registry，依赖方向单向 |
| debug 状态存储 | 内存 Map | 重启清零符合预期，无需持久化 |
| 未知 `/xxx` | 不拦截，交给 LLM | 避免误拦截用户的正常消息如 `/斜杠` |
