# Agent 能力层迁移方案

## 问题陈述

当前 `@clawbot/server` 包同时承担了两个角色：

1. **HTTP 容器** — 启动进程、API 路由、微信桥接
2. **Agent 大脑** — 对话编排、记忆系统、命令、工具/技能加载、会话管理

而 `@clawbot/agent` 包只包含底层的 LLM runner、tool/skill 注册机制，是一个"太薄"的基础库。

```text
现状：
  agent/  → LLM 循环 + tool/skill 注册（纯机制，无业务）
  server/ → HTTP 容器 + Agent 大脑 + DB 层 + 一切其他
```

这导致：
- 新增 Agent 能力（如定时任务）只能放 server，因为 conversation、tape、chat 都在 server
- Agent 的认知能力（记忆、对话、命令）和传输层（HTTP、微信协议）耦合
- 无法独立测试 Agent 逻辑，必须启动完整 server

## 目标

将 Agent 的认知能力从 server 中提取出来，形成清晰的三层架构：

```text
目标：
  agent/     → Agent 大脑（对话编排、记忆、命令、工具、会话管理）
  server/    → HTTP 容器（API 路由、微信桥接、进程生命周期）
  其他包      → 各自独立的关注��
```

**依赖方向严格单向：server → agent → observability / shared**

## 迁移范围

### 需要迁入 agent 的模块

| 模块 | 当前位置 | 迁移理由 |
| ---- | -------- | -------- |
| conversation.ts | server/src/ | 对话历史管理是 Agent 核心能力 |
| tape/ | server/src/tape/ | 记忆系统是 Agent 核心能力 |
| commands/ | server/src/commands/ | 命令是 Agent 的交互能力 |
| ai.ts 中的对话编排 | server/src/ai.ts | chat() 是 Agent 的核心入口 |
| scheduler/ | server/src/scheduler/ | 定时任务是 Agent 的主动能力 |

### 留在 server 的模块

| 模块 | 理由 |
| ---- | ---- |
| index.ts | 进程入口、生命周期管理 |
| runtime.ts | 微信 bot 启动/连接管理 |
| agent.ts | 微信消息路由（薄桥接层） |
| api/ | REST API 路由 |
| webhooks/ | Webhook HTTP 入口 |
| login/ | 登录管�� |
| proactive-push.ts | 推送（transport 层能力） |
| mcp/manager.ts | MCP 服务管理（server 运维能力） |
| paths.ts | 文件路径配置 |

### 留在 server 但需要重新审视的模块

| 模块 | 说明 |
| ---- | ---- |
| db/ | Prisma 客户端和数据访问层。详见"DB 层处理策略" |
| observability/ | 可观测性服务的运维管理，trace 写入等 |

## 关键设计决策

### 1. DB 层怎么处理？

这是整个迁移中最核心的决策。tape、conversation、messages 都直接依赖 Prisma。

**方案：DB 层留在 server，agent 通过接口抽象访问**

```text
agent/
├── ports/                    # 抽象接口（agent 自己定义）
│   ├── message-store.ts      # 消息存储接口
│   ├── tape-store.ts         # Tape 存储接口
│   └── conversation-store.ts # 会话元数据接口
├── conversation/             # 对话管理（依赖 ports，不依赖 Prisma）
├── tape/                     # 记忆系统（依赖 ports，不依赖 Prisma）
└── ...

server/
├── db/                       # Prisma 实现（实现 agent 定义的接口）
│   ├── message-store.impl.ts
│   ├── tape-store.impl.ts
│   └── ...
└── bootstrap.ts              # 启动时注入实现
```

**为什么不把 Prisma 也搬到 agent？**

- agent 包应该是纯业务逻辑，不绑定具体 ORM / 数据库
- 这样 agent 的逻辑可以用 in-memory 实现做单元测试，不需要数据库
- 未来如果换存储（比如 SQLite for local、PostgreSQL for cloud），只需在 server 层换实现

**依赖注入方式：**

不需要复杂的 DI 框架。用简单的模块级 setter 即可：

```typescript
// agent/src/ports/tape-store.ts
export interface TapeStore {
  createEntry(params: CreateEntryParams): Promise<string>;
  findEntries(query: FindEntriesQuery): Promise<TapeEntryRow[]>;
  findLatestAnchor(accountId: string, branch: string): Promise<TapeAnchorRow | null>;
  createAnchor(params: CreateAnchorParams): Promise<void>;
  markCompacted(entryIds: bigint[]): Promise<void>;
  purgeCompacted(retentionDays: number): Promise<number>;
}

let store: TapeStore | null = null;

export function setTapeStore(impl: TapeStore): void { store = impl; }
export function getTapeStore(): TapeStore {
  if (!store) throw new Error("TapeStore not initialized — call setTapeStore() at startup");
  return store;
}
```

### 2. ai.ts 怎么拆？

当前 `ai.ts` 是一个 400+ 行的大文件，混���了：
- LLM 配置（model、provider、apiKey）
- Tool/Skill 注册表初始化
- 对话编排（chat 函数：加载历史 → 注入记忆 → 调 runner → 持久化 → 提取记忆）
- 媒体处理（send_file 解析、图片路径修正）
- 调试模式

**拆分策略：**

```text
agent/
├── chat.ts                # chat() 核心编排函数（从 ai.ts 迁入）
├── media.ts               # send_file 解析、路径修正（从 ai.ts 迁入）
├── config.ts              # AgentConfig 类型定义
└── ...

server/
├── ai.ts                  # 缩减为：读 env → 构建 config → 创建 agent 实例
│                          # 不再包含 chat() 逻辑
└── ...
```

**迁移后的 server/ai.ts 只做"组装"：**

```typescript
// server/src/ai.ts（迁移后）
import { createClawbotAgent } from "@clawbot/agent";

// 读取环境变量，构建配置
const config = { model, apiKey, systemPrompt, ... };

// 注入 DB 实现
setMessageStore(new PrismaMessageStore());
setTapeStore(new PrismaTapeStore());

// 创建 agent 实例
export const agent = createClawbotAgent(config);
```

### 3. conversation.ts 的 DB 依赖怎么处理？

`conversation.ts` 包含：
- 内存中的对话历史缓存（Map）
- 从 DB 恢复历史（restoreHistory）
- 写入 DB（通过 queuePersistMessage）
- 会话锁

**策略：内存管理留在 agent，DB 操作通过 port 接口**

```text
agent/src/conversation/
├── history.ts     # 内存缓存 + 锁（纯内存，不依赖 DB）
├── types.ts       # 接口定义
└── index.ts

agent/src/ports/
└── message-store.ts  # 定义 restoreHistory / persistMessage 接���
```

history.ts 接收一个 `MessageStore` 接口来完成持久化，而不是直接 import Prisma。

### 4. commands 的迁移

命令系统比较简单，主要注意：
- `CommandRegistry` 和 `types.ts` 直接搬
- `/reset` 命令依赖 `rotateSession`，这个逻辑在 `agent.ts`（微信会话路由）中
- rotateSession 涉及 session route DB 操作 → 通过回调/接口注入

### 5. scheduler 直接在 agent 中创建

不再放 server/src/scheduler/，直接放 agent/src/scheduler/。
- 调度器（node-cron）属于 agent 能力
- 执行逻辑调用 agent 自己的 chat()
- 推送通过 port 接口（`PushService`），由 server 注入 `sendProactiveMessage` 实现
- DB 操作通过 port 接口（`SchedulerStore`）

## 迁移后的 agent 包结构

```text
packages/agent/src/
├── index.ts                 # 公共导出
├── runner.ts                # 现有：LLM 循环
├── config.ts                # Agent 配置类型
├── factory.ts               # createClawbotAgent() 工厂函数
│
├── chat.ts                  # chat() 对话编排（从 server/ai.ts 迁入）
├── media.ts                 # 媒体文件解析（从 server/ai.ts 迁入）
│
├── conversation/            # 对话管理（从 server/conversation.ts 迁入）
│   ├── history.ts           # 内存缓存、锁、evict
│   └── index.ts
│
├── tape/                    # 记忆系统（从 server/tape/ 迁入）
│   ├── types.ts
│   ├── fold.ts              # 纯函数，无 DB 依赖
│   ├── service.ts           # record/recall/compact（通过 port 访问 DB）
��   ├── extractor.ts         # LLM 记忆提取
│   ├── queue.ts             # 异步写入队列
│   └── index.ts
│
├── commands/                # 命令系统（从 server/commands/ 迁入）
│   ├── types.ts
│   ├── registry.ts
│   ├── builtins.ts
│   ├── reset.ts
│   ├── echo.ts
│   ├── debug.ts
│   └── help.ts
│
├── scheduler/               # 定时任务（新增）
│   ├── types.ts
│   ├── manager.ts
│   ├── executor.ts
│   ├── tool.ts
│   └── index.ts
│
├── tools/                   # 现有：工具注册
│   └── ...
├── skills/                  # 现有：技能注册
│   └── ...
├── mcp/                     # 现有：MCP client
│   └── ...
├── runtime/                 # 现有：skill runtime
│   └── ...
│
├── ports/                   # 抽象接口（依赖倒置）
│   ├── message-store.ts     # 消息持久化
│   ├── tape-store.ts        # Tape 持久化
��   ├── scheduler-store.ts   # 定时任务持久化
│   ├── push-service.ts      # 消息推送
│   └── context-token.ts     # contextToken 查询
│
└── shared/                  # 现有
    └── parser.ts
```

## 迁移后的 server 包结构

```text
packages/server/src/
├── index.ts                 # 进程入口、生命周期
├── bootstrap.ts             # 组装：读 env → 创建 agent → 注入 DB 实现
├── runtime.ts               # 微信 bot 启动/连接
├── agent.ts                 # 微信消息 → agent.chat 桥接
├── proactive-push.ts        # 推送能力
├── logger.ts                # 日志
├── paths.ts                 # 路径配置
├── prisma-cli.ts            # Prisma CLI
│
├── db/                      # DB 层：Prisma 实现
│   ├── prisma.ts
│   ├── prisma-env.ts
│   ├── accounts.ts
│   ├── conversations.ts
│   ├── messages.ts
│   ├── session-routes.ts
│   ├── mcp.ts
│   ├── message-store.impl.ts    # 实现 agent 的 MessageStore 接口
│   ├── tape-store.impl.ts       # 实现 agent 的 TapeStore 接口
│   └── scheduler-store.impl.ts  # 实现 agent 的 SchedulerStore 接口
│
├── api/                     # REST API
│   └── ...
├── auth/                    # 认证
│   └── ...
├── webhooks/                # Webhook
│   └── ...
├── login/                   # 登录
│   └── ...
├── mcp/                     # MCP 服务管理
│   └── ...
├── observability/           # 可观测性
│   └── ...
├── services/                # TTS 等外部服务
│   └── ...
└── config/                  # 配置
    └── ...
```

## 迁移后的依赖关系

```text
┌───────────────┐
│   server      │
│               │
│ db/*.impl.ts ─┼──实现──→ agent/ports/*  (接口)
│ bootstrap.ts ─┼──注入──→ agent (set*Store)
│ agent.ts     ─┼──调用──→ agent.chat()
│ runtime.ts    │
│ api/          │
│ webhooks/     │
└───────┬───────┘
        │ 依赖
        ▼
┌───────────────┐
│   agent       │
��               │     ┌──────────────────┐
│ chat.ts       │     │   observability  │
│ conversation/ │──→  └──────────────────┘
│ tape/         │     ┌──────────────────┐
│ commands/     │     │   @mariozechner  │
│ scheduler/    │──→  │   /pi-ai         │
│ runner.ts     │     └──────────────────┘
│ ports/        │  (纯接口，无实现依赖)
└───────────────┘
```

**关键：agent 不依赖 server，不依赖 @prisma/client。**

## 迁移步骤（按顺序执行）

### Phase 1：建立 ports 层

在 agent 中创建 ports/ 目录，定义所有接口。这一步不移动任何现有代码，只是定义契约。

影响范围：仅 agent 包新增文件
风险：零（纯新增）

### Phase 2：迁移 tape/

1. 将 `server/src/tape/types.ts` 和 `server/src/tape/fold.ts` 直接移入 `agent/src/tape/`（这两个文件是纯函数，无 DB 依赖）
2. 改写 `tape/service.ts`：将 `getPrisma()` 调用替换为 `getTapeStore()` 接口调用
3. 将 `tape/extractor.ts` 和 `tape/queue.ts` 移入
4. 在 `server/src/db/` 中创建 `tape-store.impl.ts` 实现接口
5. 在 server 启动时注入实现
6. 更新 server 中所有 `import ... from "./tape/..."` 为 `from "@clawbot/agent"`

影响范围：tape/（5 个文件）、server 中引用 tape 的位置（ai.ts、agent.ts、index.ts）
验证：现有 tape 功能正常（记忆提取、recall、compact）

### Phase 3：迁移 conversation/

1. 将 `conversation.ts` 移入 `agent/src/conversation/history.ts`
2. 内存缓存 + 锁逻辑不变
3. `restoreHistory` / `persistMessage` / `rollbackMessages` 中的 DB 调用替换为 `MessageStore` 接口
4. 在 server 中创建 `message-store.impl.ts`
5. 更新 server 中的 import

影响范围：conversation.ts（1 个文件）、db/messages.ts（部分拆出）、ai.ts、agent.ts
验证：消息收发正常、历史恢复正常

### Phase 4：迁移 commands/

1. 将整个 commands/ 目录移入 agent
2. `CommandContext` 中的 `rotateSession` 保持回调注入（已有模式）
3. 更新 server/agent.ts 中的 import

影响范围：commands/（6 个文件）、server/agent.ts
验证：/reset /help /echo /debug 命令正常

### Phase 5：拆分 ai.ts → agent/chat.ts + server/bootstrap.ts

1. 将 `chat()` 函数及其辅助函数（extractAssistantText、finalizeReply 等）移入 `agent/src/chat.ts`
2. 将媒体处理逻辑（extractMediaFromText、resolveFilePath）移入 `agent/src/media.ts`
3. server/ai.ts 缩减为：env 读取 → config 构建 → agent 实例创建 → port 注入
4. 可重命名为 server/bootstrap.ts（更准确反映其职责）

影响范围：ai.ts（拆分为 3 个文件）
验证：完整对话流程正常（包括 tool 调用、记忆提取、媒体发送）

### Phase 6：新增 scheduler

1. 在 `agent/src/scheduler/` 中实现定时任务模块
2. 定义 `SchedulerStore` 和 `PushService` 接口
3. 在 server 中创建对应实现
4. 在 server 启动时注入实现并调用 `schedulerManager.bootstrap()`

影响范围：纯新增
验证：定时任务创建、执行、推送正常

## 每个 Phase 的验证清单

每完成一个 Phase，需要验证：

- [ ] `pnpm build` 全包编译通过
- [ ] 微信消息收发正常
- [ ] AI 对话功能正常（包括 tool 调用）
- [ ] 命令（/reset /help）正常
- [ ] 记忆提取和 recall 正常
- [ ] Webhook 推送正常
- [ ] Web UI 功能正常（对话列表、消息查看）
- [ ] MCP 工具正常

## 不做的事情

| 事项 | 理由 |
| ---- | ---- |
| 把 Prisma schema 搬到 agent | agent 不应绑定具体 ORM |
| 把 proactive-push ��到 agent | 推送是 transport 层能力，不是 agent 认知能力 |
| 把 MCP manager 搬到 agent | MCP 的 client（协议通信）已在 agent，manager（服务生命周期）属于 server 运维 |
| 把 API 路由搬到 agent | HTTP 是 server 的事 |
| 创建新的 @clawbot/db 包 | DB 实现跟 server 的部署、配置强绑定，独立包是过早抽象 |
| 引入 DI 框架 | 模块级 setter/getter 足够简单且类型安全 |

## 风险与缓解

| 风险 | 缓解措施 |
| ---- | -------- |
| 迁移过程中功能回归 | 每个 Phase 独立提交，完整验证后再进入下一 Phase |
| 循环依赖 | 严格遵守 server → agent 单向依赖，agent 只通过 ports 定义接口 |
| agent 包变得过大 | 当前总量约 15 个文件，可控。未来如果持续增长再拆子包 |
| import 路径大量变更 | 使用 IDE 批量重命名，每个 Phase 集中处理 |

## 时间预估

| Phase | 工作量 |
| ----- | ------ |
| Phase 1: ports 层 | 小（纯接口定义） |
| Phase 2: tape | 中（5 个文件 + 接口适配） |
| Phase 3: conversation | 中（1 个文件但依赖关系复杂） |
| Phase 4: commands | 小（直接搬，几乎无改动） |
| Phase 5: 拆分 ai.ts | 大（核心文件拆分，影响面广） |
| Phase 6: scheduler | 中（新增模块，依赖已就绪） |

���议按 Phase 顺序执行，每个 Phase 一个独立 commit。Phase 1-4 可以相对快速完成，Phase 5 需要最谨慎。
