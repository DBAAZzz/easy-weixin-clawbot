# @clawbot/agent tools / runtime 子系统重构清单（可直接实现）

> 日期：2026-06-20
> 范围：代码层 CR 的**第二批**——`scheduler/` 与 `heartbeat/` 两个 agent-tool 子系统的整套复制、`heartbeat/evaluator` 的 god function、以及若干横切债。
> 配套：`skills/` 子系统见 `docs/2026-06-20_10_38_agent-skills-refactor-tasks.md`（第一批，结构债最重）；本清单是它的补全。
> 每个任务独立成 PR、可单独发布。

## 背景：为什么不只是 skills

`skills/` 是结构债最**集中**的地方，但不是唯一。`scheduler/` 和 `heartbeat/` 这两个「对话工具 + 后台 runtime」子系统本质同构，代码却是各写一遍——`heartbeat/tool.ts:31` 的注释自己都承认「same pattern as scheduler」。把共性提出来，能同时治掉重复和一个全包 tool 定义的类型安全坑。

硬证据（实读 + grep）：

- 环境上下文单例 `let _currentContext` + set/get：`scheduler/tool.ts:44` 与 `heartbeat/tool.ts:38` 逐字重复。
- `textResult()` helper：2 份逐字相同（`scheduler/tool.ts:33`、`heartbeat/tool.ts:15`）。
- `const ctx = getCurrentContext(); if (!ctx) return "❌ 内部错误..."`：重复约 8 次。
- `args as {...}` 手动断言：**每个** tool execute 都有，绕过了 `parameters` 里 zod schema 的推断类型。
- `evaluateGoal`：190 行，「pending + backoff」transition 对象构建 4 次。
- 裸 `console.*`：`scheduler/manager.ts` 10 处 + `heartbeat/engine.ts` 10 处。

---

## 任务 1：抽共享的 agent-tool 运行上下文（消重 + 收敛 set/clear）

**现状**：`scheduler/tool.ts` 与 `heartbeat/tool.ts` 各自维护一份等价的环境上下文单例：

```ts
// 两个文件逐字重复
interface XxxContext { accountId: string; conversationId: string; }
let _currentContext: XxxContext | null = null;
export function setXxxContext(ctx: XxxContext | null): void { _currentContext = ctx; }
function getCurrentContext(): XxxContext | null { return _currentContext; }
```

server 在 `agent.ts` chat 前后分别 `setSchedulerContext` / `setHeartbeatToolContext`，两套并行。

**改动**：新建 `src/runtime/agent-tool-context.ts`，提供一份带名字的上下文槽工厂（与 ports 的 slot 思路一致）：

```ts
export interface AgentToolContext {
  accountId: string;
  conversationId: string;
}

export function createToolContextSlot() {
  let current: AgentToolContext | null = null;
  return {
    set(ctx: AgentToolContext | null) { current = ctx; },
    get(): AgentToolContext | null { return current; },
    /** 取不到就抛统一错误，省掉每个 handler 的 if(!ctx) 样板。 */
    require(): AgentToolContext {
      if (!current) throw new ToolContextMissingError();
      return current;
    },
  };
}
```

scheduler / heartbeat 各自 `const schedulerCtx = createToolContextSlot()`，导出 `setSchedulerContext = schedulerCtx.set`。**注意**：两者仍是**各自独立的槽**（server 在不同时机注入不同含义），不要合并成一个全局槽——这里消的是「代码重复」，不是「状态合并」。

**验收**
- `scheduler/tool.ts`、`heartbeat/tool.ts` 不再各写 `let _currentContext`。
- server 侧 `setSchedulerContext` / `setHeartbeatToolContext` 签名不变（行为兼容）。
- `tsc --noEmit` + 测试通过。

> 说明：heartbeat 另有一个 `_heartbeatContext: boolean`（Phase2 递归保护，`heartbeat/tool.ts:21`），语义不同，**保持独立**，不要并入上下文槽。

---

## 任务 2：共享 tool helpers + 用 zod 推断类型干掉 `args as {...}`

**现状**两个坏味道叠在一起：
1. `textResult()` 复制 2 份。
2. 每个 execute 都 `const { x, y } = args as { x: string; y?: number }`——而 `parameters` 里已经有等价的 zod schema。schema 与断言**两处真相**，改一处忘另一处编译器不报错。`tools/types.ts:10` 把 `execute(args: Record<string, unknown>)` 写死成 unknown，逼出了这些断言。

**改动**：新建 `src/tools/define-tool.ts`：

```ts
import type { z } from "zod";
import { MESSAGE_CONTENT_TYPE } from "@clawbot/shared";
import type { ToolSnapshotItem, ToolContent, ToolContext } from "./types.js";

export function textResult(text: string): ToolContent[] {
  return [{ type: MESSAGE_CONTENT_TYPE.TEXT, text }];
}

/** 用 schema 解析 args，handler 直接拿到推断类型，消灭 `args as {...}`。 */
export function defineTool<S extends z.ZodObject<any>>(def: {
  name: string;
  description: string;
  parameters: S;
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolContent[]>;
}): ToolSnapshotItem {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    async execute(rawArgs, ctx) {
      const parsed = def.parameters.safeParse(rawArgs);
      if (!parsed.success) {
        return textResult(`❌ 参数错误：${parsed.error.issues.map((i) => i.message).join("; ")}`);
      }
      return def.execute(parsed.data, ctx);
    },
  };
}
```

然后把 `scheduler/tool.ts`、`heartbeat/tool.ts`（以及其它手写 `ToolSnapshotItem` 的地方）改用 `defineTool({...})`：execute 形参直接是 `z.infer`，删掉所有 `args as {...}`。配合任务 1 的 `slot.require()`，`if (!ctx)` 样板也一并消失。

**收益**：schema 成为唯一真相、参数校验从「散落手写」变成「统一 safeParse」、类型不再能 silently drift。**这是这批里类型安全收益最高的一项。**

**验收**
- `grep -rn 'args as {' src/scheduler src/heartbeat` 归零。
- `textResult` 单一定义。
- 现有 scheduler/heartbeat 行为不变（注意：原来无校验直接断言，现在多了 safeParse，要确认 AI SDK 传入的 args 能通过 schema——理论上必然通过，因为同一 schema 也喂给了模型）。

---

## 任务 3：拆 `evaluateGoal` 的 transition 构建（190 行 god function）

**现状**：`heartbeat/evaluator.ts:121-311`，「回到 pending + backoff」这个 `GoalTransition` 被几乎逐字构建 **4 次**（`wait` 分支 `:203`、phase2 error `:240`、phase2 完成 `:279`、catch `:294`），每次约 13 行，`...tokenUpdates` + `checkCount+1` + `resumeSignal:null` + `nextCheckAt` 反复出现。

**改动**：抽 transition 构建器，集中重复逻辑：

```ts
function pendingWithBackoff(
  goal: PendingGoalRow,
  now: Date,
  lastCheckResult: string,
  tokenUpdates?: { totalInputTokens: number; totalOutputTokens: number },
): GoalTransition {
  const backoffMs = nextBackoff(goal.backoffMs);
  return {
    goalId: goal.goalId,
    newStatus: "pending",
    updates: {
      status: "pending",
      lastCheckAt: now,
      lastCheckResult,
      checkCount: goal.checkCount + 1,
      backoffMs,
      nextCheckAt: new Date(now.getTime() + backoffMs),
      resumeSignal: null,
      ...(tokenUpdates ?? {}),
    },
  };
}
```

4 个分支改为一行 `return pendingWithBackoff(goal, now, reason, tokenUpdates)`。可顺手再抽 `resolved()` / `abandoned()` 两个构建器，让 `evaluateGoal` 主体变成清晰的 verdict 分派。

**注意**：catch 分支（`:294`）原本**没有** `...tokenUpdates`（异常时拿不到 usage），用可选参数保留这个差异，别无意中改了行为。

**验收**
- `evaluateGoal` 从 ~190 行降到 ~90 行。
- transition 构建不再有逐字重复块。
- heartbeat 相关测试通过；建议补一个 `pendingWithBackoff` 的纯函数单测（backoff 递增、checkCount+1、catch 分支不含 tokenUpdates）。

---

## 任务 4（横切，P3）：scheduler / heartbeat 接结构化 logger

**现状**：全包 `console.*` 最密的两处就是 `scheduler/manager.ts`（10）和 `heartbeat/engine.ts`（10）——偏偏这俩是后台 runtime，最需要 trace 关联和 level，却全是裸 `console`。

**改动**：接 `@clawbot/observability` 的 logger（server 侧 `agent.ts` 已用 `agentLogger`，确认 observability 是否导出可复用的 logger 工厂；若无则薄封装一个）。先只改这两个文件，其余 `console` 后置。

**判断**：纯运维收益、不改逻辑，单独小 PR；不要和任务 1-3 混在一起。

---

## 复用第一批已定义的横切项（不要重复造）

以下在 `2026-06-20_10_38_agent-skills-refactor-tasks.md` 已给方案，本清单**直接复用**，不重复列任务：

- `ports/` 9× set/get 样板 → `createPortSlot<T>(name)`（skills 文档任务 5）。任务 1 的 `createToolContextSlot` 与它同源，落地时可考虑共用一个底层 slot 实现。
- `fileExists` / `execFile` 收敛（skills 文档任务 3）。

---

## 不在范围 / 确认是干净的

别在这轮顺手改这些——它们结构是好的：

- `llm/`（messages / types / provider-factory）、`conversation/context-window`、`conversation/token-estimator`、`tape/fold`、`mcp/stdio-client`：纯函数或边界清晰、职责单一、多有测试。
- `parseEvalResult` / `needsUser` 的中文正则兜底（`evaluator.ts:49` `:261`）：脆，但已有 JSON 优先 + 日志兜底，属可接受的容错，**不在本轮重构**——真要改是 prompt/结构化输出的话题，另议。

## 优先级（跨两份文档统一看）

| 顺序 | 任务 | 来源 | 性价比 | 风险 |
|------|------|------|--------|------|
| 1 | skills 类型守卫 + `RuntimeAdapter` | skills 文档 任务1+2 | 最高 | 中 |
| 2 | tool 上下文槽 + `defineTool`（消 `args as`）| 本文档 任务1+2 | 高（含类型安全）| 低 |
| 3 | `evaluateGoal` 拆 transition 构建 | 本文档 任务3 | 中 | 低 |
| 4 | fileExists/execFile/ports 槽收敛 | skills 文档 任务3+5 | 中 | 低 |
| 5 | scheduler/heartbeat 接 logger | 本文档 任务4 | 低（运维）| 低 |

**主线**：先做 skills（债最重），再做 tool 上下文槽 + `defineTool`（一次性消掉两个子系统的复制 + 全包 `args as` 类型坑），其余是顺势清理。两份文档合起来，就是 agent 包结构债的完整改进路线。
