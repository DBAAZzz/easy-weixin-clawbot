# Heartbeat 重构：从 Goal 跟进引擎到 Reminder 提醒器

> 状态：设计已确认，待实现
> 日期：2026-07-27
> 影响范围：`packages/agent/src/capabilities/heartbeat/`、`packages/server`（Prisma schema + 迁移基建）

## 1. 背景

现有 heartbeat 实现的是一套「待办目标跟进引擎」：Agent 在对话中登记 pending goal，后台每 60 秒轮询，用两阶段 LLM 评估（Phase 1 轻量裁决 → Phase 2 完整 chat）推进目标状态机，配合退避重试、`waiting_user` 恢复链、token 预算等机制。

这与产品初衷不符。期望中的 heartbeat 是**每分钟检测有没有需要主动提醒的事务**，它提供的能力是**活人感**——这个微信号像一个会主动冒泡的人，而不是一个盯着待办清单的任务型助理。

goal 那套状态机服务的是后者。本次重构删除它，替换为一个极简的提醒器。

## 2. 目标与非目标

### 目标

- heartbeat 每分钟扫描到期提醒，在**真实会话上下文**中生成并推送主动消息
- Agent 可在对话中随手登记「什么时候、说什么」，到点触发
- 大幅削减代码量与概念数量

### 非目标

- 不做目标跟踪、不做多轮评估、不做重试直到成功
- 不做「Agent 自主推断此刻该不该说话」（Q1 曾选此方向，后改为轻量登记制）
- 不做提醒执行历史的持久化与可观测面板（见 §10 已知取舍）

## 3. 关键决策记录

| # | 决策 | 理由 |
|---|---|---|
| D1 | 提醒由 Agent 在对话中**显式登记**，而非每次 tick 让 LLM 自主推断 | 自主推断需要为每个活跃会话跑 LLM，成本与噪音不可控 |
| D2 | 到点**跑一次完整 chat 现场生成**内容，而非推送登记时写死的文本 | 冻结文本隔两天推出来生硬过时；现场生成能结合新信息，活人感更强 |
| D3 | **保留独立轮询 tick + 新建 `reminders` 表**，不折叠进 scheduler | 见 §4 |
| D4 | 在**真实会话**中执行，不用隔离会话 | scheduler 跑在 `scheduler:${seq}` 隔离上下文，读不到用户历史，这直接杀死活人感 |
| D5 | **先删行后执行**，失败不重试 | 重复骚扰对活人感的伤害大于丢一条提醒；`DELETE ... RETURNING` 顺带提供原子抢占 |
| D6 | 工具用**绝对时刻 `fire_at`**（ISO8601），非 `delay_minutes` | LLM 格式化日期比做算术可靠 |
| D7 | 本次**接入 Prisma Migrate**，替代 `db push` | 见 §6 |

### D3 的依据：为什么不复用 scheduler

scheduler 已支持 `type: "once"`（`scheduler/tool.ts:71`），执行模型看似一致，但有三处结构性差异：

1. **调度模型不同**。scheduler 用 `node-cron` 为每个任务注册常驻内存定时器（`manager.ts:35`，存于 `activeJobs` Map），重启靠 `bootstrap()` 重建 + 30 分钟补偿窗口。这适合长期重复任务，不适合大量短命的一次性提醒——每条都占一个定时器，还要走补偿逻辑。轮询扫表对短命提醒更合适：不占定时器、重启即恢复、无需补偿。
2. **执行上下文不同**。`constants.ts:16` 的 `schedulerConversationId(seq)` 刻意让任务跑在隔离会话，这是 scheduler 的核心设计。改它风险高，且会破坏 scheduler 现有语义。
3. **可见性不同**。scheduler 任务是用户可见可管理的（`list_scheduled_tasks`、`/tasks`）。Agent 随手记的小提醒混进去会污染用户任务列表。

此外 scheduler 有 30 分钟最小间隔硬限制（`validateMinInterval`），且 cron 表达式不适合表达「25 分钟后」。

## 4. 数据模型

### 新增 `reminders`

```prisma
model Reminder {
  id             BigInt   @id @default(autoincrement())
  reminderId     String   @unique @default(dbgenerated("gen_random_uuid()")) @map("reminder_id") @db.Uuid
  accountId      String   @map("account_id") @db.Text
  conversationId String   @map("conversation_id") @db.Text
  prompt         String   @db.Text
  fireAt         DateTime @map("fire_at") @db.Timestamptz(6)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

  @@index([fireAt], map: "idx_reminders_fire_at")
  @@index([accountId], map: "idx_reminders_account")
  @@map("reminders")
}
```

**没有 status 字段——行的存在本身就是状态。** 触发成功即删行。这是它比 `pending_goals`（22 个字段、5 种状态）简单一个数量级的根本原因。

`conversationId` 存真实会话 id（不是 `scheduler:N`）。

### 删除 `pending_goals`

整表删除。

## 5. 运行时设计

### 5.1 Tick

```
每 60s:
  rows = findDue(now, TICK_BATCH_SIZE)           // ORDER BY fire_at LIMIT 20
  for row of rows:
    enqueueForAccount(row.accountId, async () => {
      claimed = await claimById(row.reminderId)   // DELETE ... RETURNING *
      if (!claimed) return                        // 已被其他实例/上一轮取走
      result = await chatExecutor.execute({
        accountId: row.accountId,
        conversationId: row.conversationId,      // 真实会话
        prompt: row.prompt,
        runKind: "heartbeat",
        inputRole: "trigger",                    // 见 §5.2
        triggerMeta: { kind: "reminder", reminderId: row.reminderId },
      })
      if (result.status === "completed" && result.text?.trim()) {
        await push.sendProactiveMessage(
          row.accountId, row.conversationId, result.text,
          { recordHistory: false },              // 见 §5.2
        )
      }
    })
```

保留 `engine.ts` 现有的 `setInterval` + `unref()` 骨架和 `accountQueues` 每账号串行队列（避免同一个人同时收到两条主动消息）。

**删除 `inflight` Set**：抢占已由 `DELETE ... RETURNING` 在数据库层保证，内存去重是多余的。这顺带修复了旧实现「无租约、多实例重复执行」的缺陷。

### 5.2 主动消息的落库模型

在真实会话中执行主动消息，会同时撞上三个问题。它们必须一起解决，否则任何一个的单独修复都会引发另一个。

#### 问题一：assistant 消息双写

`chat()` 在真实会话执行时通过 `queuePersistMessage` 把 assistant 回复落库（`turn.ts:218`）；而 `sendProactiveMessage` 推送后又调 `appendAssistantText` 再写一次（`proactive-push.ts:39`）。同一句话在历史里出现两遍。

scheduler 没踩到，是因为它跑在隔离会话——chat 写进 `scheduler:N`，push 写进真实会话，各写各的。

#### 问题二：伪造的 user 消息

`chat()` 会把输入 text 构造成 **user 消息并持久化**（`turn.ts:380-386`）。若直接在真实会话跑 reminder 的 prompt，历史里会多出一条用户从未发过的消息（如「问问他面试结果怎么样」）。用户在 Web 后台看得到它，更严重的是 **LLM 在之后每一轮都会认为用户说过这话**。

这是 scheduler 选择隔离会话的第三个理由——让这条假 user 消息落在用户看不见的地方。

#### 问题三：连续 assistant 消息

`agentToModelMessages`（`llm/messages.ts:168`）**只合并连续的 toolResult，对连续 assistant 不做任何处理**，直接透传给 provider。Anthropic 要求角色严格交替，会拒绝这样的消息数组。

这是**现有代码里已存在的隐患**，不是本设计引入的：scheduler（`agent.ts:188`）和 RSS（`rss/task-service.ts:284`）通过 `appendAssistantText` 单方面追加 assistant 消息，真实会话历史会变成 `user → assistant → assistant(主动)`，再推一次就是三条。

#### 解法（三处改动）

**(1) 新增 `trigger` role，触发信息独立成一条消息**

触发信息作为**独立一条消息**落库，使用新 role `trigger`。session 记录因此是完整且直观的——历史里明确地有「因为这条提醒，所以说了这句话」两条记录，而不是把来源藏在 assistant 消息的 payload 里。

```ts
// packages/shared/src/constant/messages.ts
export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL_RESULT: "toolResult",
  TRIGGER: "trigger",          // 新增
} as const;

// packages/agent/src/llm/types.ts
export interface TriggerMessage {
  role: "trigger";
  content: TextContent[];       // 触发用的 prompt 原文
  timestamp: number;
  meta: { kind: "reminder"; reminderId: string };
}
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | TriggerMessage;

// packages/agent/src/ports/chat-executor.ts
interface ChatExecutionRequest {
  // ...现有字段
  /** 输入 prompt 以何种 role 落库。默认 "user"。 */
  inputRole?: "user" | "trigger";
  /** inputRole 为 "trigger" 时写入该消息的 meta。 */
  triggerMeta?: { kind: "reminder"; reminderId: string };
}
```

`turn.ts:380-386` 的 `buildUserMessage` 按 `inputRole` 构造 `UserMessage` 或 `TriggerMessage`，其余落库路径不变。

**发给 LLM 时，trigger 消息转成带标记的 user 角色**：

```
role: "user", content: "[系统触发·提醒] 问问他面试结果怎么样"
```

不能直接跳过——本轮 LLM 需要这条指令才知道要说什么。转成 user 保证了角色交替合法；加 `[系统触发·提醒]` 前缀让模型清楚这不是用户在说话，避免它在后续轮次里误以为用户提过这个要求。这一步在 `agentToModelMessages` 里做。

**(2) 受影响的链路**

| 位置 | 改动 | 说明 |
|---|---|---|
| `shared/constant/messages.ts:1` | 加 `TRIGGER` | |
| `agent/llm/types.ts:93` | 加 `TriggerMessage` 并入 `AgentMessage` 联合类型 | TS 会把所有未穷尽的 switch/if 报出来，据此定位剩余改动点 |
| `agent/llm/messages.ts:168` | `agentToModelMessages` 加 trigger 分支，转 user 角色 + 前缀 | |
| `agent/engine/conversation/context-window.ts:143` | `findSafeCutIndex` 的「Ensure we start with a user message」循环要把 trigger 也视为合法起点 | 否则裁剪时 trigger 消息会被跳过丢失，assistant 就没了来由 |
| `agent/engine/turn.ts:380-386` | `buildUserMessage` 按 `inputRole` 分支 | |
| `web/src/lib/message-timeline.ts` | 加 trigger 分组处理 | |
| `web/src/components/MessageBubble.tsx` | 渲染为分隔式提示条（如「⏰ 提醒触发：…」），不是对话气泡 | |

**不需要改的**（已确认）：`restoreHistory`（`server/db/messages.ts:381`）和 `hydrateMessage`（同文件 190 行）都是 role 无关的——只克隆 payload 并处理 content 里的图片块，`TriggerMessage` 的 `content: TextContent[]` 天然兼容。

**(3) 无条件移除 `messages.role` 的 CHECK 约束**

早期的 `packages/server/supabase/schema.sql` 里 messages 表带 `CHECK (role IN ('user','assistant','toolResult'))`，而 Prisma schema 未声明该约束（`schema.prisma:135` 是裸 `String @db.Text`）。`db push` 不会移除它不认识的约束，所以线上库可能仍留着这条 CHECK——若存在，写入 `role = 'trigger'` 会直接报错。

在 §11 的 reminders migration 里无条件执行，不做前置核实：

```sql
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
```

`IF EXISTS` 是幂等的，约束不存在时静默通过，因此不需要先 `\d+ messages` 确认。

两点实施注意：

1. **这条语句 `prisma migrate dev` 不会自动生成**。Prisma 只从 schema 差异推导 SQL，而它不知道这条 CHECK 的存在（schema 里没声明）。必须手工追加到生成出来的 `migration.sql` 末尾。
2. **约束名假定为 Postgres 默认命名**。`supabase/schema.sql` 里它是列级内联约束（`role TEXT NOT NULL CHECK (...)`），Postgres 默认命名为 `messages_role_check`。若实际库中该约束由其他方式创建而名称不同，这条 `IF EXISTS` 会静默跳过、约束仍在，届时写入 trigger 消息会报错——报错信息会直接给出真实约束名，按名重跑一次即可。

**(4) `agentToModelMessages` 合并相邻 assistant 消息**

在 `llm/messages.ts:168` 增加合并分支：相邻 assistant 消息的 content 拼接为一条后再发给 provider。解决问题三。

这是兜底修复，与 heartbeat 无关——**它同时修掉 scheduler 和 RSS 现有的隐患**，因此应作为独立 bugfix 提交（见 §11 第 1 步），不挂在本重构下。

**(5) PushService 加 `recordHistory`**

既然 assistant 消息由 chat 落库，push 只需负责发到微信，不再重复写历史。给 `sendProactiveMessage` 加 `opts?: { recordHistory?: boolean }`，heartbeat 传 `false`，scheduler 与 RSS 两个现有调用方不传、行为不变。解决问题一。

#### 最终历史形态

```
user(用户上次说的) → assistant(上次回复) → trigger(提醒 prompt) → assistant(主动消息)
                                              ↑ 独立可见，来源一目了然
                                              ↑ 发给 LLM 时转 user 角色 + [系统触发·提醒] 前缀
```

heartbeat 路径因此天然满足角色交替（trigger→user、后接 assistant），(4) 的合并修复只为兜住 scheduler / RSS 的既有历史。

### 5.3 错误处理：一律不重试

| 失败点 | 处理 |
|---|---|
| chat 执行失败 | `logger.warn` 后丢弃（行已删） |
| push 失败 | `logger.warn`；历史里有记录但用户未收到 |

不重试是刻意的：提醒有时效性，重试到十分钟后推一条「提醒你十分钟前该做的事」比不推更破坏活人感。旧 heartbeat 的退避重试服务的是「任务必须完成」，与本设计目标相反。

## 6. Prisma Migrate 接入

### 现状

全仓 0 个迁移文件，只有 `schema.prisma` + `db push`。`docs/2026-04-21_00_11_docker-deployment-architecture.md:262` 曾明确「当前仓库不是 migration-first」，并把过渡到 `migrate deploy` 列为未来路线（同文件 456 行）。本次兑现该路线。

`packages/server/supabase/schema.sql` 只有 5 张表，而 `schema.prisma` 有 29 个 model，落后 24 张，自 `first commit` 起未维护，属误导性文件。

本次改动含 `DROP TABLE pending_goals`，是本仓第一次破坏性 schema 变更，`db push` 对此无任何留痕。

### 命令职责划分

`migrate dev` 是**维护者的开发期命令**，需要 shadow database；`docker-compose.yml` 自带的 `postgres:16-alpine` 是 superuser，本地开发可用。用户部署只跑 `migrate deploy`，不需要 shadow database，因此 Supabase 与自建 PG **两种部署方式的迁移成本相同**，无需为此收窄支持范围。

| | 维护者 | 用户（Docker PG） | 用户（Supabase / 外部 PG） |
|---|---|---|---|
| 命令 | `migrate dev --name xxx` | `migrate deploy` | `migrate deploy` |
| 需要 shadow DB | 是（本地 compose PG 提供） | 否 | 否 |

### 一次性基线步骤

因为**当前只存在维护者自己的开发/自用库**，不需要 bootstrap 引导脚本、漂移检测或分版发布。

```bash
# 1. 在当前 schema（仍含 PendingGoal）状态下生成基线，对齐现状
mkdir -p packages/server/prisma/migrations/0_init
pnpm -F @clawbot/server exec tsx src/prisma-cli.ts migrate diff \
  --from-empty --to-schema-datamodel prisma/schema.prisma --script \
  > packages/server/prisma/migrations/0_init/migration.sql

# 2. 标记为已应用（不实际执行 SQL）
pnpm -F @clawbot/server exec tsx src/prisma-cli.ts migrate resolve --applied 0_init

# 3. 改 schema.prisma：删 PendingGoal，加 Reminder

# 4. 生成并应用第二个 migration（含 DROP TABLE + CREATE TABLE）
pnpm -F @clawbot/server exec tsx src/prisma-cli.ts migrate dev --name replace_goals_with_reminders
```

`prisma-cli.ts` 已注入 `DATABASE_URL` 与 `DIRECT_URL`，migrate 命令走同一 wrapper，无需新增环境变量管道。

### 配套改动

| 项 | 改动 |
|---|---|
| `packages/server/package.json` | 新增 `prisma:migrate:dev` / `prisma:migrate:deploy` / `prisma:migrate:resolve` 脚本，均走 `prisma-cli.ts` |
| `prisma:push` | 删除。无存量库需要过渡，不再有存在理由 |
| `packages/server/supabase/schema.sql` | 删除。`0_init/migration.sql` 完整取代其职能 |
| `Dockerfile` / 启动流程 | 启动前从 `prisma:push` 改为 `migrate deploy` |
| `docs/2026-04-21_00_11_docker-deployment-architecture.md` | 230/243/260/275/283 行的 `prisma:push` 引用改为 `migrate deploy`；456 行路线图条目标记完成 |
| `AGENTS.md:93` | 数据库命令段落更新 |

## 7. 工具接口

`heartbeatToolRegistry` 保留（合并进 `createCompositeToolRegistry`，`ai.ts:134` 不变），工具替换为 3 个：

| 工具 | 参数 | 校验 |
|---|---|---|
| `create_reminder` | `fire_at`（ISO8601 带时区）、`prompt` | 必须晚于当前时间；距now 不超过 `MAX_FIRE_AHEAD_MS`（7 天）；该账号待触发数 < `MAX_PENDING_PER_ACCOUNT`（20） |
| `list_reminders` | — | 列出待触发项，含 `reminder_id` 与时间 |
| `cancel_reminder` | `reminder_id` | 删除一行；不存在时返回提示而非报错 |

常量与 §5.1 的 `TICK_BATCH_SIZE`（每 tick 最多取 20 行）是两个独立的量，数值巧合相同，不要合并。

### 7.1 HeartbeatStore 新接口

```ts
interface HeartbeatStore {
  createReminder(input: CreateReminderInput): Promise<ReminderRow>;
  findDue(now: Date, limit: number): Promise<ReminderRow[]>;
  /** 原子删除并返回被删行；返回 null 表示已被他人取走或不存在。
   *  tick 用它做抢占，cancel_reminder 用它做删除——两者是同一个操作。 */
  claimById(reminderId: string): Promise<ReminderRow | null>;
  listByAccount(accountId: string): Promise<ReminderRow[]>;
}
```

用绝对时刻而非 `delay_minutes`：「明天早上 9 点」是最常见场景，让 LLM 输出 `2026-07-28T09:00:00+08:00` 比让它算「1020 分钟后」可靠——模型格式化日期强于做算术。chat profile 的 `injectTime: true` 保证它知道当前时间。

`cancel_reminder` 不是 YAGNI：用户说「不用提醒我了」而 Agent 到点仍推送，是最伤活人感的失败模式。

沿用现有约束：`runKind === "heartbeat" | "scheduler"` 时拒绝创建提醒（防递归自我登记），复用 `tool.ts:40` 的现有判断。

## 8. 删除清单

### `packages/agent/src/capabilities/heartbeat/`

| 文件 / 符号 | 处理 |
|---|---|
| `evaluator.ts` | 整个删除（两阶段评估、verdict 解析、5 个 transition 构造器） |
| `reason-internal.ts` | 整个删除（Phase 1 专用） |
| `types.ts` 的 `GoalStatus` / `GoalOrigin` / `Verdict` / `GoalTransition` / `PendingGoalRow` / `CreateGoalInput` / `UpdateGoalInput` / `LIMITS` / `INITIAL_BACKOFF_MS` / `MAX_BACKOFF_MS` / `BACKOFF_MULTIPLIER` / `nextBackoff()` | 全部删除，替换为 `ReminderRow` / `CreateReminderInput` 与单个配额常量 |
| `types.ts` 的 `HeartbeatExecutionRequest` / `HeartbeatExecutionResult` | 删除（已是死代码，无任何调用方） |
| `engine.ts` 的 `applyTransition` / `checkWaitingGoalsAsync` / `inflight` | 删除 |
| `engine.ts` 的 `setInterval` 骨架 / `enqueueForAccount` / `accountQueues` | **保留** |
| `tool.ts` 三个工具 | 全部替换（见 §7） |

### 其他包

| 位置 | 处理 |
|---|---|
| `packages/agent/prompts/heartbeat-eval.md` | 删除 |
| `prompts/profiles.ts` 的 `heartbeat_eval` profile、`PROMPT_ASSET_SPECS` 中对应条目、`PromptLane` 中的 `heartbeat_eval` | 删除 |
| `packages/agent/prompts/heartbeat-exec.md` + `PROMPT_TEMPLATES.heartbeat_exec` | 删除。提醒的 prompt 由 Agent 登记时自行写明，不再需要模板包装 |
| `packages/agent/src/ports/heartbeat-store.ts` | 接口从 11 个方法缩减为 4 个（见 §7.1） |
| `packages/agent/src/ports/message-store.ts` 的 `getMessagesSince` | 删除（唯一调用方是 evaluator 的增量上下文读取） |
| `packages/server/src/db/heartbeat-store.impl.ts` | 按新接口重写 |
| `packages/server/src/agent.ts:328-339` post-chat 钩子 | 删除（唯一调用方是 `checkWaitingGoalsAsync`） |
| `packages/agent/src/index.ts` heartbeat 导出段 | 按新符号更新 |

粗估：删约 600 行，新增约 200 行。

## 9. 测试

`packages/agent/test/heartbeat/` 下现有 `evaluator.test.ts` 与 `tool.test.ts` 重写。覆盖：

| 用例 | 断言 |
|---|---|
| tick 选取 | 只取 `fire_at <= now` 的行，未到期不取 |
| 原子抢占 | 并发两次 tick 对同一行，`claimById` 只成功一次，chat 只执行一次 |
| chat 失败 | 记 warn，不恢复行，不重试 |
| **push 不重复写历史** | heartbeat 路径传 `recordHistory: false`；针对 §5.2 问题一的回归测试 |
| PushService 兼容 | scheduler / RSS 不传 opts 时仍写历史 |
| **`inputRole: "trigger"`** | reminder 的 prompt 落库为 `role: "trigger"` 消息而非 user 消息，`meta.reminderId` 正确 |
| **trigger 转 user 送模型** | `agentToModelMessages` 把 trigger 转为 user 角色并加 `[系统触发·提醒]` 前缀；本轮 LLM 收得到指令 |
| **裁剪不丢 trigger** | `findSafeCutIndex` 在 trigger 消息处可作为合法起点，不会跳过它导致 assistant 失去来由 |
| **历史还原** | `restoreHistory` 能还原 trigger 消息（回归测试，确认 role 无关的 hydrate 路径成立） |
| **相邻 assistant 合并** | 历史含连续 assistant 时，`agentToModelMessages` 输出合并为一条；三条及以上同样合并（§5.2 问题三） |
| 合并不误伤 | `user → assistant → user → assistant` 不被合并；toolResult 分组逻辑不受影响 |
| 每账号串行 | 同账号两条同时到期的提醒不并发执行 |
| 工具校验 | `fire_at` 为过去时间 → 拒绝；超 7 天 → 拒绝；超配额 20 → 拒绝 |
| 递归防护 | `runKind: "heartbeat"` 下调用 `create_reminder` 被拒 |

## 10. 已知取舍

1. **无执行历史**。触发即删行，推过的提醒查不到。Web 后台无法展示「这个号最近主动说过什么」。若日后需要可观测性，需另加 `reminder_runs` 表或改为软删除。
2. **单条提醒可能丢失**。先删后执行意味着 chat 失败时提醒消失。这是对「宁可漏说、不可重复骚扰」的刻意选择。
3. **主动推送依赖 `contextToken`**。`proactive-push.ts:19` 要求会话有缓存的 contextToken，微信侧从未聊过的联系人推不出去。提醒只能发生在已有对话的会话中。
4. **`prisma:push` 移除后不可回退**。若日后出现无法用 migration 表达的场景，需重新引入。考虑到只有自用库，风险可控。
5. **新增 `trigger` role 是跨包破坏性改动**。它落在 `@clawbot/shared` 的 `MESSAGE_ROLE` 上，`AgentMessage` 联合类型随之扩大，agent / server / web 三个包都要处理新分支。好处是 TS 会把所有未穷尽的分支报出来，改动点不会遗漏；代价是这次改动无法只局限在 heartbeat 目录内。
6. **trigger 消息会占用上下文预算**。它作为一条真实消息参与上下文窗口计算，长 prompt 会挤占历史。当前 prompt 由 Agent 登记时自行控制长度，未设上限；若日后发现挤占明显，可在 `create_reminder` 加 prompt 长度校验。
7. **合并相邻 assistant 是有损的**。两条主动消息被合并成一条发给 LLM 后，模型无法区分它们是分两次说的。对上下文理解无实质影响，但如果日后需要「模型知道自己隔了多久说了第二次」，要改为在合并时插入时间标记。

## 11. 实施顺序

1. **独立 bugfix，先行合并**：`agentToModelMessages` 合并相邻 assistant 消息（§5.2 问题三）。这是修复 scheduler / RSS 现有隐患，与本重构无依赖关系，应单独提交
2. Prisma 基线：`0_init` + `migrate resolve --applied`（不改任何表结构，先确认基线正确）
3. 改 `schema.prisma`（删 `PendingGoal`、加 `Reminder`）→ `migrate dev --name replace_goals_with_reminders`，然后**手工在生成的 `migration.sql` 末尾追加** `ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;`（§5.2 (3)）
4. 加 `MESSAGE_ROLE.TRIGGER` 与 `TriggerMessage` 类型 → 跑 `tsc --noEmit` 收集所有未穷尽分支，逐个处理（`agentToModelMessages`、`findSafeCutIndex`、`buildUserMessage`、web 两处）
5. 改 `HeartbeatStore` port 接口 + server 侧实现
6. 扩展 `ChatExecutorPort` 的 `inputRole` / `triggerMeta` 参数
7. 扩展 `PushService` 的 `recordHistory` 参数（先加参数保持默认行为，独立可验证）
8. 重写 `engine.ts` tick
9. 重写 `tool.ts` 三个工具
10. 删除 evaluator / reason-internal / prompt 资产 / post-chat 钩子 / `getMessagesSince`
11. Web 侧渲染 trigger 消息（`message-timeline.ts` 分组 + `MessageBubble.tsx` 提示条样式）
12. 重写测试
13. 更新 `package.json` 脚本、`Dockerfile`、`AGENTS.md`、部署文档；删除 `supabase/schema.sql`
14. `tsc --noEmit` 三包全过：`@clawbot/agent`、`@clawbot/server`、`@clawbot/web`
15. 冒烟验证：登记一条 1 分钟后触发的提醒，确认历史里出现 `trigger` + `assistant` 两条、微信侧收到消息、Web 后台渲染正常
