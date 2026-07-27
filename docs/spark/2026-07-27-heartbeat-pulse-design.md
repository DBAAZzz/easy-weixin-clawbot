# Heartbeat 重构（第二版）：从 Reminder 提醒器到 Pulse 自省节拍

> 状态：设计已确认，待实现
> 日期：2026-07-27
> 取代：`2026-07-27-heartbeat-reminder-redesign-design.md`（第一版，已实现但方向错误，见 §2）
> 影响范围：`packages/agent/src/capabilities/heartbeat/`、`packages/server`

## 1. 背景

heartbeat 要提供的能力是**活人感**——这个微信号像一个会主动冒泡的人。

第一版把它做成了 reminder 提醒器：Agent 在对话中登记 `{fireAt, prompt}`，到点执行。已实现并跑通，但**没有达成目标**。

## 2. 第一版为什么是错的

活人感不来自「按时说话」。活人不给你设闹钟。让人觉得对面是活物的，是**开口的决定在那一刻做出，依据是那一刻的状况**。

reminder 的决定是在登记时做出的，被编码成一个时间戳；到点只是取出预设指令执行。这是 scheduler 的定义。

而 `create_scheduled_task` 本就在工具表里，Agent 自己就能调，支持 `type: "once"`。第一版列出的四条「区别」全部站不住：

| 声称的区别 | 实际是什么 |
|---|---|
| 绝对时刻 vs cron | 一个参数格式 |
| 无 30 分钟下限 | 一个常量 |
| 真实会话执行 | `ScheduledTask` 上的一个 flag |
| Agent 内部不可见 | 一个 visibility 字段 |

四条都是 `ScheduledTask` 上的字段或开关，没有一条需要独立的表、tick、port 和工具集。**没有区分度的实现是重复，重复即腐败。**

### reminder 不该被 scheduler 顶替，而是根本不需要

Agent 知道「他明天 9 点面试」时，这件事**已经在 Tape 记忆里**（memory 抽取本就在做）。pulse 求值器明早读记忆时会看到它，自己决定要不要问一句。

**记忆本身就是提醒。**造 reminders 表等于让 Agent 用日程软件模拟记性——那当然像定时任务，因为它就是。

## 3. 职责边界

```
用户明确要一个时间点的东西   → scheduler（已存在，用户可见可管理，cron / once）
Agent 自己判断要不要开口     → heartbeat pulse（记忆驱动，零预登记）
```

区分度是结构性的，不是参数上的：

- **scheduler 有「任务」这个对象**。执行什么、何时执行，登记时全部确定。
- **heartbeat 没有任何对象**。只有一个节拍：每隔一段时间，让 Agent 读着记忆问自己「此刻有什么值得说的吗」。说什么、要不要说、下次何时再想——全在那一刻决定。

`conversation_pulse` 表**没有 prompt 字段**。这是它与 scheduler 最本质的差别：**它不存指令，只存节奏。**

## 4. 目标与非目标

### 目标

- 每分钟扫到期的会话节拍，让 Agent 基于记忆与沉默时长自主判断是否开口
- 开口时在真实会话跑一次 chat，生成当下该说的话
- Agent 自定下次自省时间——自适应节拍本身就是成本控制

### 非目标

- 不做任何形式的预登记指令（那是 scheduler）
- 不读完整对话历史（见 D2）
- 不做主动消息的可观测面板

## 5. 关键决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 删除 reminders 表与三个 reminder 工具，不保留 | 与 scheduler 无区分度；记忆已覆盖其能力 |
| D2 | 求值输入**只有记忆与沉默时长**，不含原始对话 | 成本恒定可预测；赌注是「记忆抽取已把重要的事沉淀下来」，这个赌注若不成立，该修的是记忆抽取而非在此绕过 |
| D3 | 由模型自己给出 `next_eval_in_minutes` | 自适应节拍是成本控制的核心；固定轮询才会成本爆炸 |
| D4 | 克制规则**在代码里强制**，不信任模型自觉 | 静默时段、每日上限、退避都是硬约束，模型只提建议 |
| D5 | `quietStreak` 驱动指数退避下限 | 保证冷会话自然衰减到每天一次，无需人工配置 |
| D6 | 开口走既有 trigger role 链路 | 第一版建的基建对 pulse 完全适用 |

## 6. 数据模型

```prisma
/// Per-conversation proactive rhythm. Holds no instruction — only when the
/// agent should next consider speaking, and how restrained it must be.
model ConversationPulse {
  id               BigInt    @id @default(autoincrement())
  accountId        String    @map("account_id") @db.Text
  conversationId   String    @map("conversation_id") @db.Text

  nextEvalAt       DateTime  @map("next_eval_at") @db.Timestamptz(6)
  lastSpokeAt      DateTime? @map("last_spoke_at") @db.Timestamptz(6)
  /// Consecutive evaluations that decided to stay quiet. Drives backoff.
  quietStreak      Int       @default(0) @map("quiet_streak")
  /// Date the daily counter refers to (Asia/Shanghai).
  spokenDate       DateTime? @map("spoken_date") @db.Date
  spokenToday      Int       @default(0) @map("spoken_today")

  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt        DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([accountId, conversationId], map: "conversation_pulse_account_conv_key")
  @@index([nextEvalAt], map: "idx_conversation_pulse_next_eval")
  @@map("conversation_pulse")
}
```

同时**删除 `reminders` 表**。

### 行的创建与用户活动

post-chat 钩子 `notePulseActivity(accountId, conversationId)`：upsert 一行，并把 `nextEvalAt` 推到 `now + PULSE_MIN_MINUTES`。用户刚说完话，不需要马上冒泡。

## 7. 求值循环

```
每 60s:
  rows = SELECT * FROM conversation_pulse WHERE next_eval_at <= now LIMIT 20
  for row of rows:
    enqueueForAccount(row.accountId, async () => {
      claimed = claimForEval(row.id, now)     // 乐观并发：UPDATE ... WHERE next_eval_at = 原值
      if (!claimed) return

      verdict = await evaluatePulse(row)      // reasonInternal，单次 generateText
      applyVerdict(row, verdict)
    })
```

抢占用乐观更新而非删行（pulse 行是长期存在的，不能删）：`UPDATE conversation_pulse SET next_eval_at = <推迟> WHERE id = ? AND next_eval_at = <读到的值>`，受影响行数为 0 表示已被他人取走。

### 求值输入

`pulse_eval` profile：`injectSkills: false`、`injectTapeMemory: true`、`injectTime: true`、`injectRecentContext: false`。

用户消息内容：

```
## 当前状态
- 距用户上次说话: 6 小时
- 距你上次主动开口: 从未 / 2 天
- 连续判定无话可说: 3 次
- 今日已主动开口: 0 次（上限 3）
```

记忆由 profile 注入，时间由 assembler 注入（已带 GMT+8 偏移）。

### 求值输出

```json
{ "speak": false, "reason": "他刚说在忙", "prompt": null, "next_eval_in_minutes": 180 }
```

`speak` 为真时 `prompt` 必填——写给到时候的自己的指令，例如「问问他上午那个会开得怎么样」。

解析失败一律降级为 `{speak: false, next_eval_in_minutes: 240}` 并 `logger.warn`，不静默吞。

### 硬约束（代码强制，模型只提建议）

| 约束 | 值 | 作用 |
|---|---|---|
| `PULSE_MIN_MINUTES` | 30 | `next_eval_in_minutes` 下限 |
| `PULSE_MAX_MINUTES` | 1440 | 上限 |
| 退避下限 | `30 × min(2^quietStreak, 48)` 分钟 | 冷会话自然衰减到每天一次 |
| 静默时段 | 23:00–08:00 (Asia/Shanghai) | 落在此区间则不开口，`nextEvalAt` 顺延到 08:00 |
| 每日上限 | 3 条/会话 | 超出则强制不开口 |
| 开口最小间隔 | 4 小时 | 距 `lastSpokeAt` 不足则不开口 |
| 未回复退避 | `lastSpokeAt` 之后无用户消息 → 下次下限翻倍 | 对方不理就别追着说 |

任何一条硬约束否决开口时，仍写回 `nextEvalAt`，`quietStreak` 照常累加。

### 开口路径

复用第一版建好的链路，无需新增：

```ts
chatExecutor.execute({
  accountId, conversationId,          // 真实会话
  prompt: verdict.prompt,
  runKind: "heartbeat",
  inputRole: "trigger",
  triggerMeta: { kind: "pulse" },
});
// → PushService.sendProactiveMessage(..., { recordHistory: false })
```

成功后：`lastSpokeAt = now`、`spokenToday += 1`、`quietStreak = 0`。
chat 失败或回复为空：记 warn，按未开口处理，不重试。

`TriggerMeta.kind` 从 `"reminder"` 改为 `"pulse"`。

## 8. 删除与保留

### 删除

| 项 | 说明 |
|---|---|
| `reminders` 表 | migration 删除 |
| `create_reminder` / `list_reminders` / `cancel_reminder` | 三个工具整体删除 |
| `HeartbeatStore` 四个方法 | 换成 pulse 的四个 |
| `engine.ts` 的 `fireReminder` | 换成求值循环 |
| `chat-system.md` 的「主动跟进」章节 | Agent 不再需要知道如何登记提醒 |
| `types.ts` 的 `ReminderRow` / `CreateReminderInput` / `MAX_PENDING_PER_ACCOUNT` / `MAX_FIRE_AHEAD_MS` | — |

### 保留（第一版建的基建，对 pulse 同样适用）

- Prisma migrate 基建与 `0_init` 基线
- `trigger` role 全链路（shared 常量、`TriggerMessage`、`agentToModelMessages` 转换、`findSafeCutIndex`、Web 渲染）
- 相邻 assistant 合并（本就是独立 bugfix）
- `PushService.recordHistory`、`ChatExecutorPort.inputRole` / `triggerMeta`
- tick 骨架、每账号串行队列
- 注入时间携带 GMT+8 偏移

### 新增

- `conversation_pulse` 表 + migration
- `capabilities/heartbeat/evaluator.ts`（求值 + 硬约束）
- `prompts/pulse-eval.md` + `pulse_eval` profile
- post-chat 钩子 `notePulseActivity`

## 9. 测试

| 用例 | 断言 |
|---|---|
| tick 选取 | 只取 `next_eval_at <= now` |
| 乐观抢占 | 并发两次求值只有一次生效 |
| 求值输出解析 | 合法 JSON 正确解析；非法输出降级为不开口 + 240 分钟，并 warn |
| `next_eval_in_minutes` 钳制 | 低于 30 抬到 30，高于 1440 压到 1440 |
| 退避 | `quietStreak` 增长时下限按 `30 × 2^n` 抬升，封顶 1440 |
| 静默时段 | 落在 23:00–08:00 不开口，`nextEvalAt` 顺延到 08:00 |
| 每日上限 | 已开口 3 次后强制不开口；跨日后计数归零 |
| 最小间隔 | 距 `lastSpokeAt` 不足 4 小时不开口 |
| 未回复退避 | `lastSpokeAt` 后无用户消息时下限翻倍 |
| 开口路径 | `inputRole: "trigger"`、`triggerMeta.kind === "pulse"`、push 带 `recordHistory: false` |
| chat 失败 | 不重试，按未开口处理，`quietStreak` 累加 |
| 用户活动 | `notePulseActivity` 把 `nextEvalAt` 推到 `now + 30min` |

## 10. 已知取舍

1. **求值不读原始对话**。记忆抽取漏掉的细节、语气、没说完的话，pulse 看不到。若发现判断质量不足，正确的修法是改进记忆抽取，而不是在这里绕过去读全量历史——否则成本模型会退回到第一版被否决的形态。
2. **主动开口没有执行历史**。`trigger` 消息本身留在会话里可查，但没有「求值了多少次、否决了多少次」的统计。
3. **依赖 `contextToken`**。`proactive-push.ts:19` 要求会话有缓存 contextToken，从未聊过的联系人推不出去。
4. **冷启动偏保守**。新会话 `quietStreak` 为 0、`lastSpokeAt` 为空，首次求值最快也要等 30 分钟。

## 11. 实施顺序

1. 删除 reminder 工具、store 方法、`fireReminder`、`chat-system.md` 的「主动跟进」章节
2. `schema.prisma`：删 `Reminder`，加 `ConversationPulse` → 生成 migration → `migrate deploy` → `prisma:generate`
3. `HeartbeatStore` port 换成 pulse 四方法 + server 实现
4. `prompts/pulse-eval.md` + `pulse_eval` profile + `PROMPT_ASSET_SPECS` 条目
5. `evaluator.ts`：求值 + 硬约束（纯函数部分与 IO 分离，便于测试）
6. `engine.ts`：tick 改为求值循环
7. post-chat 钩子 `notePulseActivity`
8. `TriggerMeta.kind` 改为 `"pulse"`
9. 测试
10. 文档：`packages/agent/AGENTS.md` 的 Heartbeat 章节改写
11. `tsc --noEmit` 三包全过 + 冒烟
