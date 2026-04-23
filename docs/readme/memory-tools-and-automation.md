# 记忆、工具、技能、RSS 与任务

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

## RSS 订阅与任务中心

当前版本新增了一套面向内容运营的 RSS 能力：

- 订阅源支持两类来源：`rsshub_route` 和 `rss_url`
- `RSS订阅` 页面支持新增、编辑、删除、启停、测试抓取和预览最近内容
- `任务中心` 页面支持 `rss_brief` 和 `rss_digest` 两类任务，可绑定账号、选择多个订阅源、设置 Cron、静默时段和最大条数
- RSSHub 连接参数统一放在 `设置 -> RSS` 中配置，支持 Base URL、认证方式、请求超时和连接测试
- 采集结果会先进入统一采集池，再按账号级去重规则推送给目标账号

## Prompt 定时任务

支持按账号配置定时任务：

- 使用 Cron 表达式定义调度
- 可随时启用或停用
- 每次执行会记录结果

这里的 `Prompt任务` 指通用 AI Prompt 调度任务，和 RSS 任务中心分开管理。

管理入口：

- 记忆图谱：`/memory-graph`
- 工具管理：`/tools`
- 技能管理：`/skills`
- RSS 订阅：`/rss-subscriptions`
- 任务中心：`/task-center`
- Prompt 任务：`/scheduled-tasks`

## 继续阅读

- [docs/memory-system-architecture.md](../memory-system-architecture.md)
- [docs/tape-memory-storage.md](../tape-memory-storage.md)
- [docs/markdown-skill-system.md](../markdown-skill-system.md)
- [docs/scheduler-design.md](../scheduler-design.md)
- [docs/superpowers/specs/2026-04-22-rss-subscriptions-and-task-center-design.md](../superpowers/specs/2026-04-22-rss-subscriptions-and-task-center-design.md)
