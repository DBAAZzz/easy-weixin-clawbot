# Webhook、MCP、可观测性

## Webhook

项目支持外部系统通过 Webhook 向指定微信账号投递消息。

特点：

- 独立 Token 认证
- 支持按账号授权
- 保留投递日志，方便排查

管理入口：`/webhooks`

## MCP

支持在后台管理 MCP Server 和 MCP Tool：

- 新增 / 编辑 / 启停 MCP Server
- 发现并管理 MCP Tool
- Tool 启用状态可单独控制

管理入口：`/mcp`

## 可观测性

内置运行观测能力：

- Trace 视图
- 调用链明细
- Tool / LLM 轮次耗时
- `/api/metrics` 指标导出

管理入口：`/observability`

## 继续阅读

- [docs/webhook-integration.md](../webhook-integration.md)
- [docs/mcp-architecture.md](../mcp-architecture.md)
- [docs/agent-observability.md](../agent-observability.md)
