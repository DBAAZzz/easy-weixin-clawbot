# 记忆、工具、技能、定时任务

## 记忆系统

项目使用 Tape 记忆模型，核心是两层记忆：

- 全局记忆：跨会话保留
- 会话记忆：当前会话上下文

系统会把对话中的事实、偏好、决策等内容结构化存储，并在需要时自动压缩。

## 工具与技能

- Tool：可调用能力，例如内置 `opencli`
- Skill：通过 Markdown 注入的领域知识

工具和技能都支持 builtin / user 两类来源，并通过后台管理启用状态。

相关目录：

- `data/tools/builtin`
- `data/tools/user`
- `data/skills/builtin`
- `data/skills/user`

## 定时任务

支持按账号配置定时任务：

- 使用 Cron 表达式定义调度
- 可随时启用或停用
- 每次执行会记录结果

管理入口：

- 记忆图谱：`/memory-graph`
- 工具管理：`/tools`
- 技能管理：`/skills`
- 定时任务：`/scheduled-tasks`

## 继续阅读

- [docs/memory-system-architecture.md](../memory-system-architecture.md)
- [docs/tape-memory-storage.md](../tape-memory-storage.md)
- [docs/markdown-skill-system.md](../markdown-skill-system.md)
- [docs/scheduler-design.md](../scheduler-design.md)
