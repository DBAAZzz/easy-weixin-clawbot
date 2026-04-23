# 定时任务（Scheduler）设计方案

## 概述

为 Clawbot 添加定时任务能力，支持用户通过自然语言创建、管理定时任务，到时自动执行并将结果推送到指定微信会话。

### 实现更新（2026-04）

- 调度壳已经演进为通用 `ScheduledTask` 模型，新增 `taskKind` 和 `configJson` 字段
- `prompt` 任务仍由调度器直接调用 `chat()` 执行
- `rss_digest` / `rss_brief` 任务通过 `ScheduledTaskHandlerPort` 委托给 server 侧 RSS service 执行
- Web 后台中，`/scheduled-tasks` 继续只展示 Prompt 任务；RSS 任务改由 `/task-center` 管理

### 前置依赖

> ✅ `sendProactiveMessage(accountId, conversationId, text)` — 已有主动推送能力
> ✅ `chat(accountId, conversationId, text)` — 已有 AI 对话能力
> ✅ `ToolRegistry` — 已有 Agent Tool 注册机制
> ✅ `CommandRegistry` — 已有聊天命令注册机制
> ✅ PostgreSQL + Prisma — 已有持久化层

## 动机与定位

### 为什么需要定时任务？

当前系统是被动响应模式：用户发消息 → Agent 回复。定时任务让 Agent 具备**主动执行**能力——在指定时间自动完成工作并推送结果，不需要用户触发。

典型场景：

- 每天早上 9 点推送新闻摘要
- 每周一生成周报提醒
- 定期检查某个 URL 的状态
- 每天推送天气/日程等个性化内容

### 在系统中的位置

定时任务是 Agent 的一种**主动能力扩展**，而非 Server 的职责。它的本质是：

```text
时间触发 → 调用 Agent 能力（AI 对话 / 工具执行） → 推送结果到会话
```

与现有能力的关系：

| 能力       | 触发方       | 执行内容        | 交付方式   |
| ---------- | ------------ | --------------- | ---------- |
| 普通对话   | 用户消息     | AI 回复         | 同步回复   |
| Webhook    | 外部 HTTP    | 透传/格式化     | 主动推送   |
| **定时任务** | **Cron 时钟** | **AI Prompt 执行** | **主动推送** |

三者共享同一条推送通道（`sendProactiveMessage`），区别仅在触发方式。

## 架构设计

### 整体流程

```text
┌──────────────────────────────────────────────────────────────┐
│                       用户交互层                              │
│                                                              │
│  自然语言："帮我设一个定时任务，每天早上9点推送科技新闻摘要"     │
│  Agent Tool：create_scheduled_task(name, cron, prompt)       │
│  快捷命令：/schedule list · /schedule pause 3                │
│                                                              │
└──────────────┬───────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│                    SchedulerManager                           │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────────┐ │
│  │ CRUD     │   │ node-cron│   │ Executor                 │ │
│  │ 增删改查  │   │ 调度器   │   │ 执行 + 推送 + 记录日志    │ │
│  └──────────┘   └──────────┘   └──────────────────────────┘ │
│                                                              │
└──────────────┬───────────────────────────────────────────────┘
               │
       ┌───────┼──────────┐
       ▼       ▼          ▼
   chat()   sendPro-   Prisma DB
   AI 执行  activeMsg  持久化
```

### 模块划分

```text
packages/server/src/scheduler/
├── types.ts          # 类型定义
├── manager.ts        # 调度管理器：bootstrap / activate / deactivate
├── executor.ts       # 执行逻辑：调用 AI → 推送结果 → 写日志
├── db.ts             # Prisma CRUD 封装
├── tool.ts           # Agent Tool 定义（create / delete / list）
└── command.ts        # /schedule 快捷命令（list / pause / resume）
```

选择放在 `server/src/scheduler/` 而非独立包的原因：

- 当前阶段只有定时任务一种异步场景，独立包是过早抽象
- 它需要访问 `chat()`、`sendProactiveMessage()`、Prisma 等 server 内部能力
- 当前已经接入 RSS 任务，但仍保持“共享调度外壳 + 各模块独立执行器”的结构，暂不提取额外公共抽象

当前实现已经进一步拆分为：通用调度壳位于 `packages/agent/src/scheduler/`，RSS 采集与任务逻辑位于 `packages/server/src/rss/`，两者通过 `ScheduledTaskHandlerPort` 连接。

### 核心设计决策

#### 1. 调度方案：node-cron + DB 持久化

**选择 node-cron（进程内调度）而非 BullMQ / pg_cron 的理由：**

- 当前是单 Node 进程部署，不需要分布式调度
- 任务定义和执行记录持久化到 PostgreSQL，进程重启时从 DB 重建调度
- 零外部依赖（不需要 Redis）
- 如果未来需要多实例，迁移到 BullMQ 只需替换 manager.ts 中的调度逻辑，executor 和 DB 层不变

**启动恢复流程：**

```text
进程启动
  → DB.findMany({ enabled: true })
  → 逐个注册 node-cron job
  → 检查是否有错过的任务（见"启动补偿"）
  → 每个 job 触发时调用 executor
```

**启动补偿（Missed Tick Recovery）：**

进程重启可能错过预定的执行。bootstrap 时对每个任务检查：
- 如果 `nextRunAt` 已过去且 `lastRunAt` < `nextRunAt`（说明该次未执行）
- 且距离 `nextRunAt` 在合理窗口内（如 30 分钟以内）
- 则触发一次补偿执行

超出窗口的直接跳过，等待下一个正常周期。不做复杂的"队列堆积回放"。

#### 2. 执行策略

- **串行执行**：同一任务不允许并发执行（上一次未完成则跳过本次）
- **超时控制**：单次执行有上限（如 60s），超时视为失败
- **错误隔离**：单个任务失败不影响其他任务
- **连续失败处理**：连续失败 N 次（如 3 次）后自动暂停，避免无意义消耗 token
- **频率下限**：创建时强制最小间隔 30 分钟，防止用户设置过高频率导致 token 大量消耗

#### 3. 执行上下文隔离

**关键设计：定时任务使用独立的 conversationId 执行 AI 对话，不污染用户的聊天上下文。**

```text
用户聊天上下文：  accountId + conversationId（用户正常对话）
任务执行上下文：  accountId + "scheduler:{taskSeq}"（独立隔离）
推送目标：        accountId + conversationId（用户指定的会话）
```

好处：
- 任务的多次执行之间可以有连续记忆（"昨天推送过的新闻不要重复"）
- 不会把定时任务的 prompt/response 插入用户正在进行的聊天历史
- 推送目标仍然是用户指定的会话，只是 AI 思考的"工作区"是独立的

#### 4. 推送与 contextToken 失效处理

与 Webhook 一样，推送依赖会话的 `contextToken`（24h 有效）。

**失效处理策略（不静默失败）：**

1. 执行前检查 contextToken 是否存在
2. 如果已失效：
   - AI 执行仍然正常进行（结果有价值，不应浪费）
   - Run 记录标记为 `pushed: false`
   - 结果暂存在 ScheduledTaskRun 中
3. 用户下次发消息时（contextToken 刷新），检查该会话是否有未推送的任务结果
4. 有则补发，附带提示："以下是您离线期间的定时任务结果"

这个方案在微信协议限制下是最务实的选择。

## 数据模型

### ScheduledTask — 任务定义

| 字段           | 类型      | 说明                                   |
| -------------- | --------- | -------------------------------------- |
| id             | BigInt    | 主键                                   |
| taskId         | UUID      | 内部标识                               |
| accountId      | String    | 所属微信账号                           |
| conversationId | String    | 推送目标会话                           |
| seq            | Int       | per-account 自增序号（用户可见的短 ID） |
| name           | String    | 任务名称（用户可见）                   |
| prompt         | String    | 要执行的 AI Prompt                     |
| cron           | String    | Cron 表达式                            |
| timezone       | String    | 时区，默认 Asia/Shanghai               |
| enabled        | Boolean   | 是否启用                               |
| status         | String    | idle / running / error / paused        |
| lastRunAt      | DateTime? | 上次执行时间                           |
| nextRunAt      | DateTime? | 下次执行时间                           |
| lastError      | String?   | 最近错误信息                           |
| runCount       | Int       | 累计执行次数                           |
| failStreak     | Int       | 连续失败次数（达到阈值自动暂停）       |

**短 ID 设计：** `seq` 是 per-account 的自增序号（#1, #2, #3）。用户操作时使用 `/schedule pause 3` 而非 UUID。内部仍用 UUID 做跨系统标识。

### ScheduledTaskRun — 执行记录

| 字段       | 类型     | 说明                                 |
| ---------- | -------- | ------------------------------------ |
| id         | BigInt   | 主键                                 |
| taskId     | BigInt   | 关联任务                             |
| status     | String   | success / error / timeout / skipped  |
| prompt     | String   | 执行时的 prompt 快照                 |
| result     | String?  | AI 回复内容                          |
| durationMs | Int?     | 执行耗时                             |
| error      | String?  | 错误信息                             |
| pushed     | Boolean  | 是否成功推送到会话                   |
| createdAt  | DateTime | 执行时间                             |

**为什么需要 Run 表？**

- 排查问题：某次推送内容不对，可以回溯当时的 prompt 和结果
- 补发依据：`pushed: false` 的记录在 contextToken 恢复后可以补发
- 统计分析：成功率、平均耗时、token 消耗趋势
- 用户查询：`/schedule history 3` 查看最近执行记录

## 用户交互

### 创建方式：AI Tool（自然语言 + 确认）

**核心理念：系统本身就是 AI Agent，不应该让用户手写 cron 表达式。**

在手机微信键盘上输入 `--cron "0 9 * * *"` 是极其糟糕的体验。正确的做法是将定时任务的创建注册为 Agent Tool，让 AI 理解用户意图后自动调用：

```text
用户：帮我设一个定时任务，每天早上9点给我推送科技新闻摘要

Agent（内部调用 create_scheduled_task tool）：
  好的，我为你创建了定时任务：
  📌 名称：科技新闻摘要
  ⏰ 时间：每天 09:00（Asia/Shanghai）
  📝 内容：请给我今天的科技新闻摘要
  任务编号：#3

用户：帮我把 #3 改成每天早上8点半
Agent（内部调用 update_scheduled_task tool）：
  已更新，#3 的执行时间改为每天 08:30。
```

**Tool 定义（注册到 ToolRegistry）：**

- `create_scheduled_task` — 创建定时任务（参数：name, cron, prompt, timezone?）
- `update_scheduled_task` — 修改任务（参数：seq, 可选的 name/cron/prompt/enabled）
- `delete_scheduled_task` — 删除任务（参数：seq）
- `list_scheduled_tasks` — 列出当前会话的所有任务
- `run_scheduled_task` — 手动触发一次（参数：seq）

AI 负责将自然语言转换为 cron 表达式和结构化 prompt，用户不需要了解任何技术细节。

### 管理命令：/schedule（快捷方式）

对于明确知道自己要做什么的用户，保留命令作为快捷入口：

```text
/schedule list                  # 列出所有任务
/schedule info 3                # 查看 #3 的详情
/schedule pause 3               # 暂停 #3
/schedule resume 3              # 恢复 #3
/schedule delete 3              # 删除 #3
/schedule run 3                 # 手动触发 #3
/schedule history 3             # 查看 #3 最近执行记录
```

注意：不提供 `/schedule add` 命令。创建始终走自然语言 → AI Tool 路径，确保体验一致。

## 与 RSS 任务的关系

### 当前采用共享调度外壳

现在系统已经落地 RSS 任务，但没有把 RSS 采集逻辑硬塞进调度器本体，而是采用“共享调度外壳 + RSS 专属处理器”的方式：

- `ScheduledTask` 统一负责调度时间、启停状态、执行记录和运行时管理
- `executor` 根据 `taskKind` 决定执行路径：`prompt` 走通用 AI 对话，`rss_digest` / `rss_brief` 走 RSS handler
- RSS 专属逻辑仍保留在 `packages/server/src/rss/` 中，包括采集池、内容清洗、账号级去重和主动推送

这么做的原因是，定时任务和 RSS 订阅虽然都属于“触发 → 推送”，但实际执行模型差异很大：

| 维度     | 定时任务                   | RSS 订阅                     |
| -------- | -------------------------- | ---------------------------- |
| 触发     | 固定 cron                  | 有新内容时                   |
| 执行成本 | 高（调 AI，消耗 token）    | 低（拉 feed 解析）           |
| 输出     | AI 自由文本                | 结构化条目                   |
| 去重     | 不需要                     | 必须（已推送条目）           |
| 失败策略 | 跳过或重试                 | 保证不漏不重                 |

硬揉成统一抽象会导致每个模块为了适配接口写大量 adapter 代码，这是过早抽象的典型代价。

### 共享的是基础设施，不是抽象层

```text
scheduler/     ──┐
                  ├──→ sendProactiveMessage()   共享推送
rss/           ──┤
                  ├──→ Prisma / DB              共享持久化
                  ├──→ ToolRegistry             共享 AI Tool 入口
                  └──→ Observability            共享可观测
```

当前的边界是：调度器负责“什么时候跑”，RSS 模块负责“抓什么、怎么去重、怎么组织消息”。如果未来出现更多同类异步模块，再评估是否进一步抽取公共生命周期层。

## 生命周期管理

### 启动

```text
server/index.ts 启动时：
  → schedulerManager.bootstrap()
    → 从 DB 加载所有 enabled 任务
    → 注册 node-cron job
    → 补偿执行错过的任务（30 分钟窗口内）
    → 日志输出已加载任务数
```

### 运行时 CRUD

```text
AI Tool 调用 create_scheduled_task：
  → 校验 cron 合法性 + 频率下限（≥30min）
  → 分配 per-account seq
  → 写入 DB
  → schedulerManager.activate(task)
  → 注册新的 cron job
  → 返回确认信息给 Agent

用户 /schedule delete 3：
  → schedulerManager.deactivate(taskId)
  → 取消 cron job
  → 从 DB 删除
```

### 关闭

```text
server shutdown 时：
  → schedulerManager.shutdown()
    → 取消所有 cron job
    → 等待正在执行的任务完成（带超时）
```

## 可观测性

复用现有 observability 体系：

- 每次执行产生一条 trace（与普通 chat 共享 trace 格式）
- 关键指标：执行成功率、平均耗时、推送成功率
- 错误告警：连续失败自动暂停时，在下次用户交互时通知

## 不采纳的建议及理由

以下是评审中提出但刻意不采纳的方案，记录理由以备后续参考：

| 建议 | 不采纳理由 |
| ---- | ---------- |
| 分布式锁 / 抢占执行 | 当前单进程，无并发问题。未来多实例应换调度方案（BullMQ），不是在 node-cron 上打补丁 |
| 指数退避重试 | 定时任务执行消耗 AI token，盲目重试可能造成更大问题。当前策略：失败记日志，连续失败暂停 |
| metadata JSON 口袋字段 | 看似灵活，实际把类型安全推迟到运行时。需要扩展时加 migration 比调试 JSON schema 验证简单 |
| 持久化推送通道 | 微信协议的硬限制，绕不开。补发机制是当前最务实的方案 |

## 未来演进方向

1. **Web UI 管理** — 在现有 web 包中添加定时任务管理页面（列表、创建、查看日志）
2. **更丰富的 prompt 模板** — 支持变量（如 `{{date}}`、`{{weather}}`）
3. **执行结果后处理** — 不只是推送文本，还可以触发其他动作
4. **独立包提取** — 当异步能力增多时，从 server/scheduler 提取为 packages/scheduler
