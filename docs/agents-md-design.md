# agents.md 方案设计

## 1. 背景与动机

在 AI Coding Agents（Cursor、Copilot、Codex、Aider 等）飞速发展的背景下，`AGENTS.md` 已成为一种面向 AI 智能体的项目规范标准。它与 `README.md` 形成互补：

| 文件 | 读者 | 内容侧重 |
|------|------|----------|
| `README.md` | 人类开发者 | 项目简介、安装步骤、功能特性 |
| `AGENTS.md` | AI 编程智能体 | 精确指令、架构约束、禁止事项、命令速查 |

**为什么需要它？**

- **关注点分离**：避免在 README 中塞满构建命令细节、lint 规范等 AI 需要但人类嫌冗长的内容
- **消除幻觉**：通过结构化指令明确告知 AI 架构边界、禁止操作和必须遵循的规范
- **层级继承**：Monorepo 中子目录可以有自己的 `AGENTS.md`，AI 遵循就近原则

## 2. 方案概览

```
easy-clawbot-agent/
├── AGENTS.md                    ← 根级：全局规范（技术栈、依赖方向、编码规范、禁止事项）
├── packages/
│   ├── agent/AGENTS.md          ← Agent 引擎：Port/Adapter、Runner 循环、Tape 记忆
│   ├── server/AGENTS.md         ← 服务端：API 路由、DB、Port 实现、运行时
│   └── web/AGENTS.md            ← 前端：设计系统、React Query 模式、路由
├── README.md                    ← 人类阅读：项目介绍、安装、特性
└── docs/                        ← 深度文档索引（agents.md 引用，不重复）
```

## 3. 层级继承策略

AI 阅读规范时遵循**就近原则 + 向上追溯**：

```
当 AI 编辑 packages/web/src/pages/ToolsPage.tsx 时：
  1. 首先读取 packages/web/AGENTS.md       → 前端设计规范、React Query 模式
  2. 再向上读取 ./AGENTS.md（根级）          → 全局 TypeScript 规范、禁止事项
  3. 子包规范覆盖根级规范（如有冲突）
```

这意味着：
- **根级 AGENTS.md** 放通用规范（技术栈、依赖方向、命名约定、全局禁止事项）
- **子包 AGENTS.md** 放包专属细节（Port 接口列表、API 路由表、设计令牌规则）
- **不重复** docs/ 中已有的深度文档，仅引用链接

## 4. 各文件职责与内容设计

### 4.1 根级 AGENTS.md

**定位**：全局入口，AI 读到任何文件时都应参考。

**核心内容**：

| 章节 | 内容 |
|------|------|
| 项目概述 | 一句话定位 + 核心概念 |
| 技术栈 | 运行时、语言、框架、数据库、构建工具（表格） |
| Monorepo 结构 | 包列表 + 职责 + data/docs 目录说明 |
| 依赖方向 | `server → agent → observability → shared`，**严格单向** |
| 常用命令 | dev/build/test/prisma 命令速查 |
| 编码规范 | ESM、strict、命名约定、架构原则、错误处理 |
| Web 前端规范 | @theme 设计令牌、禁止任意值、卡片五段式 |
| 数据库 | Prisma 使用规则 |
| Markdown 工具/技能格式 | YAML frontmatter 字段模板 |
| MCP 集成 | 架构概述 |
| **禁止事项** | 7 条红线（依赖反向、Prisma 直用、任意值…） |
| 提交检查清单 | 5 项自检 |
| 子包索引 | 链接到 3 个子包 AGENTS.md |
| 文档索引 | 12 篇关键文档的路径表 |

**设计原则**：
- 不超过 300 行，保持 AI 可一次性消费
- 优先列"禁止事项"和"命令"——这两项对 AI 产出质量影响最大
- 深度内容通过链接指向 `docs/`，不在此处展开

### 4.2 packages/agent/AGENTS.md

**定位**：AI 核心引擎的架构导航。

**核心内容**：

| 章节 | 内容 |
|------|------|
| 角色定位 | 纯编排层 + 三条绝对禁止 |
| 目录结构 | 完整 src/ 树 + 每个目录一句话职责 |
| Port/Adapter | 8 个 Port 接口列表 + "新增外部依赖必须定义 Port" |
| AgentRunner 循环 | LLM → tool_calls → execute → repeat 流程图 |
| Registry + Installer | Markdown → parse → Compiled → Loader → swap 模式 |
| Tape 记忆 Reducer | fold 公式 + 分支策略 |
| Heartbeat 两阶段 | Phase1(eval) + Phase2(act) |
| 测试 | 命令 + 文件命名 + fixtures |
| 修改指南 | 5 种常见修改场景的操作步骤 |

### 4.3 packages/server/AGENTS.md

**定位**：API 和运行时实现的操作手册。

**核心内容**：

| 章节 | 内容 |
|------|------|
| 角色定位 | 应用层职责清单 |
| 目录结构 | src/ 树 + prisma/ |
| API 路由表 | 14 个模块 × 路径前缀 × 职责 |
| 启动/关闭序列 | 8 步启动 + 6 步关闭 |
| Port 实现表 | 接口 → 实现文件映射 |
| 多账号运行时 | Map 结构 + bootstrap + auto-deprecate |
| 环境变量 | 必需 vs 可选 |
| 修改指南 | 路由/DB/Port/schema 修改步骤 |

### 4.4 packages/web/AGENTS.md

**定位**：前端开发的设计系统执行手册。

**核心内容**：

| 章节 | 内容 |
|------|------|
| 目录结构 | pages/components/hooks/api/lib |
| 路由表 | 路径 → 页面 → 说明 |
| 数据流 | Page → hook → React Query → api → fetch → proxy |
| 设计系统 | @theme 令牌 + 禁止清单 + 设计原则 |
| 组件体系 | 原子/业务/页面三层 |
| 修改指南 | 新增页面/API/组件的步骤 |

## 5. 与现有文档的协作关系

```
AGENTS.md（快速参考，≤300 行）
    │
    ├── 引用 → docs/agent-architecture.md        （深度架构）
    ├── 引用 → docs/mcp-architecture.md           （MCP 详细设计）
    ├── 引用 → docs/memory-system-architecture.md （记忆系统）
    ├── 引用 → docs/页面设计规范_v2.md             （完整设计规范）
    ├── 引用 → docs/markdown-skill-system.md      （工具/技能详细设计）
    └── ...12 篇文档

README.md（人类入口）
    │
    └── 安装指南、功能特性、界面预览、LLM 配置
```

**原则**：AGENTS.md 是"索引 + 约束"，不是文档的复制品。AI 需要深入了解时，跟随链接阅读 docs/。

## 6. 维护策略

| 触发条件 | 操作 |
|----------|------|
| 新增子包 | 在子包目录下创建 AGENTS.md，根级添加索引 |
| 新增 API 路由 | 更新 server/AGENTS.md 路由表 |
| 新增页面 | 更新 web/AGENTS.md 路由表 |
| 新增 Port 接口 | 更新 agent/AGENTS.md Port 列表 + server/AGENTS.md 实现表 |
| 架构变更 | 更新根级依赖方向、技术栈 |
| 新增禁止事项 | 更新根级禁止事项清单 |

## 7. 已创建的文件清单

| 文件 | 行数 | 核心价值 |
|------|------|----------|
| `/AGENTS.md` | ~220 行 | 全局技术栈、依赖方向、编码规范、禁止事项 |
| `/packages/agent/AGENTS.md` | ~100 行 | Port/Adapter、Runner 循环、Tape 记忆、修改指南 |
| `/packages/server/AGENTS.md` | ~110 行 | API 路由表、启动序列、Port 实现、环境变量 |
| `/packages/web/AGENTS.md` | ~100 行 | 设计系统令牌、React Query 模式、路由表 |
