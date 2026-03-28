# 微信 ClawBot Agent

多账号微信 ClawBot 连接器 —— 通过 Web 后台管理多个微信号的 ClawBot 接入，支持扫码登录、对话持久化、LLM 智能回复、插件化工具/技能扩展。

## 它做什么

将多个微信号连接为 ClawBot，每个账号独立运行、独立对话。通过 Web 后台统一管理所有账号的登录、对话查看、工具/技能配置。

**核心流程：**

```
扫码登录微信号 → 账号自动注册 → 接收微信消息 → LLM 生成回复（可调用工具）→ 回复用户
                                                    ↑
                            多账号并行运行，每个账号独立 Agent 实例
```

## 多账号管理

- **扫码登录**：通过 Web 后台或 API 触发微信扫码，终端字符二维码直接渲染在页面上
- **账号生命周期**：每个微信号对应一个独立的 ClawBot 实例，登录后自动启动，支持 active/deprecated 状态管理
- **重复登录处理**：同一微信号再次扫码时，旧账号自动标记为 deprecated，新账号接管
- **账号别名**：为每个微信号设置别名，方便识别管理
- **独立 Agent**：每个账号拥有独立的 Agent 实例、对话历史、工具/技能上下文

## 界面预览

![图 0](images/2026-03-28%2017-57-16%209681bd213c51d62927ab4090e7035129e5c7c7173ed9eb7dd5748c4faf287d80.png)  

![图 1](images/2026-03-28%2017-57-55%20f126a5433a4f2f948d8934a06c8c9487fa6ef406cdf53c23a454b836933227c3.png)  

![图 2](images/2026-03-28%2017-59-07%2016c93f3d69d563ed26774531634a04f6e4fc5c59fff587606937eff97f46a662.png)  


## 架构概览

```
packages/
├── agent/    # LLM 编排引擎（工具注册、技能注入、Agent 循环）
├── server/   # 微信 ClawBot 运行时、多账号管理、Prisma 持久化、Hono HTTP API
├── shared/   # 共享 TypeScript 类型定义
└── web/      # React + Vite 管理后台（多账号视图）
```

```
data/
├── skills/builtin/   # 内置技能（翻译、摘要、专业人设）
├── skills/user/      # 用户安装的技能
├── tools/builtin/    # 内置工具（web-search、opencli）
└── tools/user/       # 用户安装的工具
```

## 快速开始

### 环境要求

- Node.js >= 18
- pnpm >= 10
- PostgreSQL（推荐 Supabase）

### 安装

```bash
# 安装依赖
pnpm install

# 复制环境配置
cp .env.example .env
```

### 配置 `.env`

```bash
# LLM 配置
LLM_PROVIDER=moonshot          # moonshot | kimi-coding | anthropic | openai
LLM_MODEL=moonshot-v1-8k      # 对应 provider 的模型名
LLM_API_KEY=your-api-key       # 或使用 provider 专属变量（ANTHROPIC_API_KEY 等）

# 系统提示词
SYSTEM_PROMPT=你是一个微信智能助手，回答简洁、友好。

# 数据库
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# API 服务
API_PORT=3001
API_SECRET=your-random-secret  # Web 后台鉴权用
WEB_ORIGIN=http://localhost:5173

# TTS（可选）
TTS_PROVIDER=edge-tts
TTS_DEFAULT_VOICE=zh-CN-XiaoxiaoNeural
```

### 启动

```bash
# 同时启动所有服务
pnpm dev

# 或分别启动
pnpm dev:agent    # Agent 编译监听
pnpm dev:server   # API 服务 + 机器人运行时（localhost:3001）
pnpm dev:web      # Web 后台（localhost:5173）
```

### 构建 & 生产运行

```bash
pnpm build
pnpm start
```

## 消息处理流程

```
微信用户发送消息
  → weixin-agent-sdk 回调
  → 根据 accountId 路由到对应 Agent 实例
  → 加载/恢复对话历史（内存优先，DB 兜底）
  → Agent 循环：系统提示词 + 技能注入 → LLM → 工具调用 → 回复
  → 异步持久化到 Supabase（不阻塞回复）
  → 回复发送给微信用户
```

## 核心概念

### Tool（工具）

可调用的函数，具有 JSON Schema 输入定义。LLM 通过 `tool_call` 触发执行，返回结构化结果。

示例：`web_search`、`opencli`

### Skill（技能）

领域知识文档，注入到系统提示词中增强 LLM 能力。支持两种激活模式：

| 模式 | 行为 |
|------|------|
| `always` | 始终注入系统提示词 |
| `on-demand` | LLM 通过 `use_skill` 工具按需加载 |

### Agent 循环

```
构建系统提示词（基础提示 + always 技能 + on-demand 技能索引）
  → 调用 LLM
  → LLM 返回 tool_call？执行工具 / 加载技能 → 结果推入历史 → 继续循环
  → LLM 返回文本？结束，回复用户
```

## Web 管理后台

统一管理所有微信 ClawBot 账号。

| 页面 | 功能 |
|------|------|
| 首页 `/` | 所有微信号卡片、active/deprecated 筛选、对话统计 |
| 对话 `/accounts/:id` | 查看某个微信号的所有对话和消息记录 |
| 登录 `/login` | 扫码添加新的微信号（终端字符二维码渲染） |
| 工具 `/tools` | 工具管理：启用/禁用、安装/卸载 |
| 技能 `/skills` | 技能管理：启用/禁用、安装/卸载 |

技术栈：React 19 + React Router 7 + Tailwind CSS 4 + shadcn/ui

## API 接口

所有接口需要 `Authorization: Bearer <API_SECRET>` 鉴权。

### 系统

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务状态、运行中的账号 |

### 账号

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/accounts` | 账号列表 + 对话数 |
| PATCH | `/api/accounts/:id` | 更新账号别名 |
| GET | `/api/accounts/:id/conversations` | 分页获取对话列表 |
| GET | `/api/accounts/:id/conversations/:cid/messages` | 游标分页获取消息 |

### 登录

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/login/start` | 触发微信登录 |
| GET | `/api/login/status` | 轮询登录状态 + 二维码 |
| POST | `/api/login/cancel` | 取消登录 |

## 数据模型

```
accounts
  ├── id, display_name, alias, deprecated, created_at

conversations
  ├── id, account_id, conversation_id, title
  ├── last_message_at, message_count, created_at
  └── UNIQUE(account_id, conversation_id)

messages
  ├── id, account_id, conversation_id, seq
  ├── role (user | assistant | toolResult)
  ├── content_text, payload (JSONB), media_type
  └── UNIQUE(account_id, conversation_id, seq)
```

设计策略：**内存优先、数据库异步写入**。内存中的对话历史是数据源，Supabase 作为持久化备份，异步队列写入不阻塞消息处理。

## 依赖关系

```
@clawbot/agent (纯库)
  └── @mariozechner/pi-ai, yaml

@clawbot/server
  ├── @clawbot/agent, @clawbot/shared
  ├── weixin-agent-sdk
  ├── @hono/node-server, @prisma/client
  └── @mariozechner/pi-ai

@clawbot/web
  ├── @clawbot/shared (仅类型)
  ├── react, react-router
  └── tailwindcss, shadcn/ui

@clawbot/shared (仅类型，无运行时依赖)
```

## 测试

```bash
pnpm test:agent
pnpm test:server
```

## 项目结构

```
├── .env.example                    # 环境变量模板
├── package.json                    # Monorepo 根配置
├── pnpm-workspace.yaml
├── data/
│   ├── skills/builtin/             # 内置技能
│   ├── tools/builtin/              # 内置工具
│   └── state.json                  # 安装状态快照
├── spec/                           # 架构设计文档
├── packages/agent/src/
│   ├── runner.ts                   # Agent 核心循环
│   ├── tools/                      # 工具注册、编译、安装
│   ├── skills/                     # 技能注册、编译、安装
│   └── runtime/skill-runtime.ts    # 按需技能加载
├── packages/server/src/
│   ├── ai.ts                       # 模型初始化 + 注册表
│   ├── runtime.ts                  # 多账号生命周期管理（核心）
│   ├── agent.ts                    # 每个账号的 Agent 创建
│   ├── conversation.ts             # 对话历史 + 并发锁
│   ├── db/                         # Prisma 持久化
│   ├── api/                        # Hono 路由
│   └── login/                      # 微信扫码登录 + 二维码捕获
└── packages/web/src/
    ├── pages/                      # 页面组件（多账号管理视图）
    ├── components/                 # UI 组件
    ├── hooks/                      # 数据获取 hooks
    └── lib/api.ts                  # REST 客户端
```

## TODO

### 多 LLM 供应商支持

通过 `@mariozechner/pi-ai` 统一接口接入多个供应商，切换只需改环境变量。已有设计，待实现。

- [ ] Anthropic（Claude）— 完整 tool-calling 支持
- [ ] OpenAI（GPT-4o）
- [ ] Moonshot（moonshot-v1-8k / 32k / 128k）
- [ ] Kimi K2 编程模型（kimi-k2-thinking）
- [ ] Google（Gemini 系列）
- [ ] API Key 优先级：`LLM_API_KEY` > 供应商专属变量 > 兼容变量 `KEY`

### Webhook 集成

外部业务系统通过 Webhook 向微信账号推送消息。设计文档见 `spec/webhook-integration.md`。

依赖 `weixin-agent-sdk` 暴露主动发送消息接口（当前仅支持请求-响应式 `Agent.chat()`）。

**Phase 1（MVP）：**

- [ ] Webhook 投递接口 `POST /api/webhooks/:accountId`
- [ ] Token 认证（SHA-256 哈希存储，`whk_` 前缀）
- [ ] 发送文本消息（最大 4000 字符）
- [ ] 完整错误响应（400/401/404/429/503）
- [ ] 投递日志（webhook_logs 表）
- [ ] Prisma 模型定义 + Migration

**Phase 2：**

- [ ] Token 管理接口（CRUD + 轮换）
- [ ] 调用日志查询接口
- [ ] 频率限制（滑动窗口，60 次/分钟/Token）
- [ ] 幂等性支持（Idempotency-Key）

**Phase 3：**

- [ ] 消息模板
- [ ] 批量发送
- [ ] 富文本消息（图片、文件）

## License

GPL-3.0
