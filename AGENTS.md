# AGENTS.md — AI Agent 开发指南

> 本文件是写给 AI 编程智能体（Cursor、Copilot、Codex、Aider 等）的项目规范。
> 人类开发者请阅读 [README.md](./README.md)。

## 项目概述

微信 ClawBot Agent —— 多账号微信 AI Agent 管理平台。每个微信号是一个独立 AI Agent，拥有独立对话历史、Tape 记忆、工具调用和个性化配置。通过 Web 后台统一管理。

## 技术栈

| 层 | 技术 |
|---|------|
| 运行时 | Node.js >= 22, pnpm >= 10.30.0 |
| 语言 | TypeScript 5.7+, 纯 ESM (`type: "module"`) |
| 后端 | Hono 4 + @hono/node-server |
| 前端 | React 19 + Vite 8 + Tailwind CSS 4 + shadcn/ui |
| 数据库 | PostgreSQL + Prisma 6 |
| AI 框架 | AI SDK 6 (Vercel) |
| 代码质量 | oxlint + oxfmt（Rust 实现，**非 ESLint/Prettier**） |
| 测试 | Node.js 原生 test runner (`tsx --test`) |
| 构建 | tsc（后端/库），Vite（前端），tsdown（weixin-*） |

## Monorepo 结构

```
packages/
  agent/        ← @clawbot/agent   AI 核心引擎（LLM 循环、技能、工具、MCP、Tape 记忆）
  server/       ← @clawbot/server  Hono API + Prisma DB + 微信运行时
  web/          ← @clawbot/web     React SPA 管理后台
  shared/       ← @clawbot/shared  纯类型包，零运行时依赖
  observability/← @clawbot/observability  Trace/Metrics/采样
  weixin-acp/   ← weixin-acp       微信 ACP 适配器（CLI）
  weixin-agent-sdk/ ← weixin-agent-sdk  微信协议 SDK
data/
  tools/        ← Markdown 工具定义（builtin/ + user/）
  skills/       ← Markdown 技能定义（builtin/ + user/）
  downloads/    ← 用户下载缓存
  media-cache/  ← 媒体文件缓存
  tts-cache/    ← TTS 语音缓存
docs/           ← 架构文档、设计规范、迭代计划
scripts/        ← 辅助脚本
```

## 依赖方向（严格单向）

```
server → agent → observability → shared
server → shared
web    → shared（仅类型）
```

**禁止反向依赖**：`agent` 不可导入 `server`；`shared` 不可导入任何其他包。

## 环境准备与常用命令

```bash
# 安装依赖
pnpm install

# 开发（同时启动所有服务）
pnpm dev

# 分别启动
pnpm dev:server   # API 服务 localhost:8028
pnpm dev:web      # Web 后台 localhost:5173

# 构建（按拓扑序自动编排）
pnpm build

# 测试
pnpm test:agent
pnpm test:server

# 数据库
pnpm -F @clawbot/server prisma:generate   # 生成 Prisma Client
pnpm -F @clawbot/server prisma:push       # 同步 schema 到数据库

# 类型检查（单包）
pnpm -F @clawbot/server exec tsc --noEmit
pnpm -F @clawbot/agent exec tsc --noEmit
pnpm -F @clawbot/web exec tsc --noEmit
```

## 编码规范

### TypeScript

- **纯 ESM**：所有 import 使用 `.js` 扩展名（`import { foo } from './bar.js'`）
- **strict 模式**：全包启用 `strict: true`
- **`module: "esnext"`**，**`moduleResolution: "bundler"`**
- 类型导出放在独立 `types.ts` 文件
- 用 `async/await` + `AbortSignal` 处理异步和取消
- 不使用 `enum`，用 `const` 对象 + `as const` 替代

### 命名约定

| 对象 | 风格 | 示例 |
|------|------|------|
| 文件名 | kebab-case | `model-resolver.ts` |
| 类/接口/类型 | PascalCase | `AgentRunner`, `TapeEntry` |
| 函数/变量 | camelCase | `createAgentRunner()` |
| 常量 | UPPER_SNAKE | `MAX_ROUNDS` |
| Markdown 工具/技能 | kebab-case | `opencli.md`, `healthy-meal-reminder.md` |
| 数据库表 | snake_case | `tape_entries`, `mcp_servers` |

### 架构原则

- **Port/Adapter 模式**：`agent` 包通过接口（`MessageStore`, `TapeStore`, `PushService`）访问外部 IO，不直接依赖 Prisma 或 HTTP
- **Registry 模式**：工具/技能/命令使用 Map 注册表，提供 `register()`, `list()`, `get()` 方法
- **Reducer 模式**：Tape 记忆 = `fold(LastAnchor.Snapshot, NewEntries[])`
- **三级配置解析**：`conversation config → account config → global config`
- **LLM 配置来源唯一**：运行时 LLM Provider/模型/API Key 只来自 Web 后台的数据库配置，不使用 `LLM_*` 或 provider 专用环境变量

### 错误处理

- 非致命错误用 `console.warn` + 降级处理
- 致命错误 `throw` + 上层捕获
- **禁止静默吞异常**：必须 log + rethrow 或显式降级

## Web 前端规范

### 设计系统

- **必须使用 `@theme {}` 设计令牌**，禁止任意值（`bg-[#xxx]`, `text-[14px]`）
- **无模块盒子**：页面不包裹大容器，用间距（spacing）而非颜色/边框创建层次
- **实体卡片五段式**：标题+副标题 | 状态+开关+菜单 | 指标 | 标签 | 元信息
- **分隔线仅用 `border-b`**：不要用深色背景块分隔

### 路径别名

- 使用 `@/` 指向 `packages/web/src/`

## 数据库

- ORM：Prisma 6，schema 位于 `packages/server/prisma/schema.prisma`
- **禁止手动修改生成的 Prisma Client 文件**
- 修改 schema 后执行 `pnpm -F @clawbot/server prisma:generate`
- JSONB 用于存储灵活 payload（messages.payload, tape_entries.payload 等）

## Markdown 工具与技能格式

工具（Tool）和技能（Skill）均使用 Markdown + YAML Frontmatter 定义。

**工具示例** (`data/tools/builtin/opencli.md`)：
```yaml
---
name: opencli           # kebab-case
version: 1.0.0
type: tool
author: clawbot
summary: 一句话描述
handler: cli             # 处理器类型
handlerConfig:
  binary: opencli
  timeout: 30000
inputSchema:
  command:
    type: string
    description: 参数说明
    required: true
---
# Markdown 正文：详细使用文档
```

**技能示例** (`data/skills/builtin/healthy-meal-reminder.md`)：
```yaml
---
name: healthy-meal-reminder
version: 1.8.0
type: skill
author: clawbot
summary: 一句话描述
activation: on-demand    # always-on | on-demand
---
# Markdown 正文：注入 LLM 上下文的知识
```

存储位置：`data/tools/{builtin,user}/`, `data/skills/{builtin,user}/`

## MCP Server 集成

- MCP Server 配置存在数据库 `mcp_servers` 表
- 工具发现后持久化到 `mcp_tools` 表
- `packages/agent/src/mcp/` 处理 stdio 协议
- `packages/agent/src/tools/composite-registry.ts` 合并本地 + MCP 工具
- Web 管理 API：`/api/mcp`

## 禁止事项

- ❌ `agent` 包导入 `server` 或任何 HTTP 代码
- ❌ `agent` 包直接使用 Prisma（必须通过 Port 接口）
- ❌ Web 前端使用 Tailwind 任意值（`bg-[#xxx]`）
- ❌ 手动修改 `node_modules/` 或 Prisma 生成文件
- ❌ 使用 CommonJS（`require`/`module.exports`）
- ❌ 使用 ESLint/Prettier（本项目用 oxlint/oxfmt）
- ❌ 静默吞异常

## 提交前检查清单

1. `pnpm -F <package> exec tsc --noEmit` 类型检查通过
2. 如修改了 Prisma schema → 已运行 `prisma:generate`
3. 如修改了 `agent` 包 → 确认未引入对 `server` 的依赖
4. 如修改了前端 → 无 Tailwind 任意值
5. 如新增/修改 Markdown 工具或技能 → frontmatter 字段完整

## 子包专属规范

各子包目录下的 `AGENTS.md` 包含更细粒度的规范，AI 应遵循**就近原则**：优先读取当前工作目录下的 `AGENTS.md`，再向上追溯到根目录。

- [packages/agent/AGENTS.md](packages/agent/AGENTS.md)
- [packages/server/AGENTS.md](packages/server/AGENTS.md)
- [packages/web/AGENTS.md](packages/web/AGENTS.md)

## 关键文档索引

| 主题 | 路径 |
|------|------|
| 架构总览 | [docs/agent-architecture.md](docs/agent-architecture.md) |
| MCP 架构 | [docs/mcp-architecture.md](docs/mcp-architecture.md) |
| Web 架构 | [docs/web-architecture.md](docs/web-architecture.md) |
| 记忆系统 | [docs/memory-system-architecture.md](docs/memory-system-architecture.md) |
| Tape 存储 | [docs/tape-memory-storage.md](docs/tape-memory-storage.md) |
| 工具/技能系统 | [docs/markdown-skill-system.md](docs/markdown-skill-system.md) |
| 内置命令 | [docs/builtin-commands.md](docs/builtin-commands.md) |
| 页面设计规范 | [docs/页面设计规范_v2.md](docs/页面设计规范_v2.md) |
| 上下文窗口管理 | [docs/context-window-management.md](docs/context-window-management.md) |
| 定时任务 | [docs/scheduler-design.md](docs/scheduler-design.md) |
| Webhook | [docs/webhook-integration.md](docs/webhook-integration.md) |
| JWT 认证 | [docs/jwt-authentication.md](docs/jwt-authentication.md) |
