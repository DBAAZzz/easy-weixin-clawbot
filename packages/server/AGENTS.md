# AGENTS.md — @clawbot/server

> Hono REST API 后端 + 微信多账号 Bot 运行时管理器。

## 角色定位

这是**应用层**，负责：
- HTTP API 暴露（Hono 4 + @hono/node-server）
- 数据库访问（Prisma 6 + PostgreSQL）
- Agent Port 接口的具体实现
- 多账号微信运行时生命周期
- MCP Server 连接管理

## 目录结构

```
src/
├── index.ts          # 入口：bootstrap MCP → 运行时 → Hono listen :8028
├── ai.ts             # Agent 配置：validate env, LLM model, registries
├── runtime.ts        # 多账号运行时：Map<accountId, {abort, startPromise}>
├── api/
│   ├── index.ts      # Hono app 创建、CORS、auth 中间件
│   └── routes/       # 16 个路由模块，register*Routes(app, deps) 模式
├── db/               # Agent Port 实现（Prisma 适配）
├── mcp/              # MCP Server manager（生命周期 + 工具发现）
├── login/            # 微信登录状态机（QR 码捕获）
prisma/
└── schema.prisma     # 数据库 schema（唯一真相源）
```

## API 路由

| 模块 | 路径前缀 | 职责 |
|------|----------|------|
| accounts | `/api/accounts` | 账号 CRUD + 状态管理 |
| conversations | `/api/accounts/:id/conversations` | 对话列表与管理 |
| messages | `/api/accounts/:id/conversations/:cid/messages` | 消息历史查询 |
| tools | `/api/tools` | 工具 CRUD + 启用/禁用 |
| skills | `/api/skills` | 技能 CRUD + 启用/禁用 |
| mcp | `/api/mcp` | MCP Server + Tool 管理 |
| webhooks | `/api/webhooks` | Webhook token CRUD + 投递日志 |
| auth | `/api/auth` | JWT 登录 |
| login | `/api/login` | 微信扫码登录流程 |
| model-config | `/api/model-config` | LLM Provider 模板 + 作用域配置 |
| observability | `/api/observability` | Trace/Metrics 查询 |
| scheduled-tasks | `/api/scheduled-tasks` | 定时任务管理 |
| tape | `/api/tape` | 记忆图谱查询 |
| health | `/api/health` | 健康检查 |

**路由注册模式**：每个模块导出 `register<Name>Routes(app, deps)` 函数。

## 启动与关闭

```
启动顺序：
  1. dotenv + yaml 配置加载
  2. Prisma Client 初始化
  3. MCP Manager bootstrap（连接已配置的 stdio MCP Servers）
  4. Bot Runtime bootstrap（从 DB 恢复 active 账号）
  5. Scheduler + Heartbeat 启动
  6. Observability store 清理
  7. Login Manager 创建
  8. Hono API 启动 → listen :8028

关闭顺序：
  1. Heartbeat 停止
  2. Scheduler 停止
  3. MCP Manager 关闭
  4. Runtime 关闭（abort 所有账号）
  5. Observability flush
  6. HTTP server 关闭
```

## Port 实现

`db/` 目录实现了 `@clawbot/agent` 定义的 Port 接口：

| Port 接口 | 实现文件 |
|-----------|----------|
| `MessageStore` | `db/message-store.ts` |
| `TapeStore` | `db/tape-store.ts` |
| `SchedulerStore` | `db/scheduler-store.ts` |
| `ModelConfigStore` | `db/model-config-store.ts` |
| `HeartbeatStore` | `db/heartbeat-store.ts` |
| `PushService` | runtime 层直接实现 |

**新增 Port 实现时**：在 `db/` 创建实现文件，在 `index.ts` 或 `ai.ts` 中通过 setter 注入到 agent。

## 数据库

- Schema 位于 `prisma/schema.prisma`，这是**唯一真相源**
- 修改 schema 后：`pnpm -F @clawbot/server prisma:generate` → `prisma:push`
- 大量使用 JSONB 字段（messages.payload, tape_entries.payload 等）
- **禁止手动修改生成的 Prisma Client**

## 多账号运行时

```
Runtime = Map<accountId, { abortController, startPromise }>
  ↓
bootstrap() → 从 DB 查询 active 账号 → ensureAccountStarted(id)
  ↓
每个账号：独立 AbortController + 微信 SDK 会话
  ↓
断开连接 → auto-deprecate 旧账号
```

## 环境变量

必需：
- `DATABASE_URL` — PostgreSQL 连接字符串
- `LLM_PROVIDER` + `LLM_MODEL` + `LLM_API_KEY`（或 Provider 专用 key）
- `API_PORT`（默认 8028）

可选：
- `DIRECT_URL` — Prisma direct connection
- `WEB_ORIGIN` — CORS 白名单

配置文件：`config.yaml`（auth 认证配置）

## 测试

```bash
pnpm test:server
# tsx --test src/**/*.test.ts
```

## 修改指南

- 新增 API 路由 → `src/api/routes/` 创建文件，在 `api/index.ts` 注册
- 新增 DB 查询 → `src/db/` 对应 store 文件
- 新增 Port 实现 → `src/db/` 新文件 + `index.ts` 注入
- 修改 schema → `prisma/schema.prisma` + generate + push
