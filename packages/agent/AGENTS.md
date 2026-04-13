# AGENTS.md — @clawbot/agent

> AI 核心引擎：LLM 循环、工具调用、技能注入、MCP 集成、Tape 记忆、定时任务、Heartbeat。

## 角色定位

这是**纯编排层**，所有外部 IO 通过 Port 接口注入。**绝对禁止**在此包中：
- 导入 `@clawbot/server` 或任何 HTTP / Express / Hono 代码
- 直接使用 Prisma Client 或任何数据库驱动
- 直接读写文件系统（通过 Loader 参数传入路径）

## 目录结构

```
src/
├── index.ts              # 公共 API barrel export
├── runner.ts             # createAgentRunner(): LLM tool-use 循环
├── chat.ts               # chat(): 完整对话编排（历史→LLM→持久化→记忆提取）
├── model-resolver.ts     # 三级配置解析（conversation → account → global → env）
├── types.ts              # 包级别类型：ChatResponse, ChatMedia
├── media.ts              # 媒体提取与路径解析
├── llm/                  # LLM 适配层（AI SDK 边界）
│   ├── types.ts          # 内部消息类型（与 AI SDK 解耦）
│   ├── messages.ts       # agentToModelMessages() 双向转换
│   └── provider-factory.ts # createLanguageModel() 多供应商工厂
├── ports/                # 8 个 Port 接口（DI 边界）
├── tools/                # 工具系统：Registry + Compiler + Loader + Installer
├── skills/               # 技能系统：Registry + Compiler + Loader + Installer
├── tape/                 # Tape 记忆：fold reducer + LLM 提取 + 压缩
├── conversation/         # 消息历史 + 上下文窗口裁剪
├── commands/             # 内置命令 (/reset /echo /debug /help)
├── scheduler/            # Cron 任务管理
├── heartbeat/            # 异步目标检查（Phase1 评估 + Phase2 执行）
├── prompts/              # Prompt 模板 + Profile 组装
├── runtime/              # Skill 运行时上下文
├── mcp/                  # MCP stdio 客户端 + 工具适配
├── shared/               # YAML frontmatter 解析等工具
└── test/                 # 测试 fixtures + helpers
```

## 核心模式

### Port/Adapter（依赖注入）

8 个 Port 定义在 `ports/`，由 `server` 包在启动时注入实现：

| Port | 职责 |
|------|------|
| `MessageStore` | 消息持久化、回滚、历史恢复 |
| `TapeStore` | Tape 条目/锚点 CRUD、压缩、分支查询 |
| `PushService` | 主动推送消息（微信） |
| `SchedulerStore` | 定时任务 + 运行记录 CRUD |
| `ModelConfigStore` | LLM Provider 模板 + 作用域配置 |
| `HeartbeatStore` | 异步目标 CRUD + 状态机 |
| `HeartbeatExecutorPort` | Phase2 聊天执行桥接 |

**添加新外部依赖时**，必须定义 Port 接口，在 `server` 侧实现。

### AgentRunner（LLM 循环）

```
LLM.complete() → assistant message (text 或 tool_calls)
  ↓ 若有 tool_calls → 并行执行（timeout 30s）
  ↓ 添加 tool results 到历史
  ↓ 重复直到 LLM 返回纯文本 或达到 maxRounds（默认 10）
```

### Registry + Installer 模式

工具和技能共享同一模式：
```
Markdown 文件 → parse(YAML + body) → CompiledTool/Skill
  ↓
Loader（从 builtin/ + user/ 加载）→ Registry.swap(snapshot)
  ↓
Installer（CRUD 用户自定义）→ 重新触发 Loader → swap
```

### Tape 记忆 Reducer

```
TapeState = fold(lastAnchor.snapshot, newEntries[])
entries = extract(对话历史) via LLM  →  facts | preferences | decisions
当条目超过阈值 → compact → 新 Anchor
```

分支策略：`__global__`（跨会话持久）、`{conversationId}`（会话临时）

### Heartbeat 两阶段

```
Phase1: 找到到期目标 → LLM 评估 → Verdict {act|wait|resolve|abandon}
Phase2: verdict == act → 通过 HeartbeatExecutorPort 执行 chat()
```

## 测试

```bash
pnpm test:agent
# 等同于 tsx --test src/**/*.test.ts
```

测试文件与源文件同目录，命名 `*.test.ts`。使用 Node.js 原生 test runner。

## 修改指南

- 新增工具处理器 → `src/tools/handlers/`，并在 handler index 注册
- 新增内置命令 → `src/commands/`，在 `builtins.ts` 注册
- 新增 Port → `src/ports/` 定义接口，`index.ts` 添加 getter/setter
- 修改 Prompt → `prompts/*.md` 模板，`src/prompts/assembler.ts` 组装逻辑
- 新增 LLM Provider → `src/llm/provider-factory.ts`
