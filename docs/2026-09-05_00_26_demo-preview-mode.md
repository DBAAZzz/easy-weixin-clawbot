# 演示模式（Demo Preview Mode）

> 目标：让新用户在**不绑定真实微信、不配置真实 LLM** 的情况下，一键盘起一个
> 数据齐全的 ClawBot，完整预览 Web 后台的页面渲染与交互过程。

## 工作原理

`DEMO_MODE=true` 时，服务在启动流程中（runtime bootstrap 之后、调度器之前）执行
`packages/server/src/seed/demo-seed.ts`，写入一套 **demo 前缀**的演示数据，并在
API 服务内注册一个**本地模拟 OpenAI 兼容端点**。演示 LLM Provider 模板的
`baseUrl` 指向该端点，因此定时任务等触发 agent 运行时能产生真实的流式回复。

安全边界：

- seed 每次启动先清理再重建，且只触碰 `demo-wxid-*` 账号与「演示」前缀的行，
  **不会读写任何真实数据**；
- 演示账号没有微信凭据，运行时会跳过连接（日志可见「账号缺少已绑定凭据，跳过启动」）；
- `/api/health` 返回 `demo_mode` 字段，Web 侧边栏据此显示「演示数据」徽标。

## 快速开始（Vercel 在线演示）

想给一个可直接分享的链接？把演示环境部署到 Vercel（无需自己运行数据库，
使用免费的 Supabase/Neon Postgres）：
[Vercel 演示部署指南](./2026-09-05_00_34_vercel-demo-deployment.md)。

## 快速开始（Docker）

```bash
docker compose --env-file docker/demo.env \
  -f docker-compose.yml -f docker-compose.demo.yml up -d
```

打开 `http://localhost:8080`，使用演示账号登录：

- 用户名：`admin`
- 密码：`demo-admin-2026`

`docker/demo.env` 中的所有密钥均为公开的演示值，**切勿用于生产**。

## 快速开始（本地开发）

```bash
# 方式一：DEMO_MODE 打开时启动服务，自动 seed
DEMO_MODE=true pnpm dev:server

# 方式二：手动执行 seed（不重启服务也可用）
pnpm -F @clawbot/server demo:seed
```

## 预置数据清单

| 数据 | 内容 |
|------|------|
| 微信账号 ×3 | 林间小屋（林夕）、产品体验官·阿屿、晚晚wanwan（无凭据，仅展示） |
| 会话 ×5 | 私聊与群聊混合，共 30+ 条中文消息（与真实链路相同的 payload 结构） |
| Tape 记忆 | 每账号 facts / preferences / decisions 各若干 + checkpoint anchor |
| 模型配置 | 「演示模型（本地模拟）」Provider 模板 + 全局 chat 使用配置 |
| 定时任务 ×3 | 全部为「已暂停」，可在页面启用后观察真实执行 |
| RSS 源 ×2 | 阮一峰周刊（含 2 条历史条目）、Hacker News 热门（停用状态） |
| Webhook | `demo-cms` 令牌 + 2 条调用日志 |
| MCP Server ×1 | 「演示 · 文件系统」（停用状态，含 2 个工具） |
| 用量 / Trace | 近 30 天用量事件 ×96、6 条含 span 的调用链 |

## 模拟 LLM 端点

`packages/server/src/api/routes/demo-llm.ts`，仅在 DEMO_MODE 下注册，路径为：

- `POST /demo-llm/v1/chat/completions`（支持 `stream: true` 的 SSE 流式回复）
- `GET  /demo-llm/v1/models`（供 Provider「测试」按钮探测）

本地验证：

```bash
curl -s http://localhost:8028/demo-llm/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"clawbot-demo-chat","stream":false,"messages":[{"role":"user","content":"你好"}]}'
```

## 让定时任务真实跑一轮

演示任务默认全部暂停。在「定时任务」页面启用「内测群反馈速览」（每 10 分钟一次），
下一个 cron 周期就会真实触发一轮 agent 执行：LLM 调用走内置模拟端点，运行记录
（status=success）与用量统计随之产生。由于演示账号没有微信凭据，最后向微信推送
一步无法完成，运行记录中的「推送」标记为 false——这也是演示的一部分。其余任务的
cron 是「每天/每周」级别的，适合观察配置形态，不适合现场等待。

## 自定义演示数据

- 人物与会话内容：`packages/server/src/seed/demo-data.ts`
- 任务 / RSS / Webhook / MCP / 用量 / Trace：`packages/server/src/seed/demo-seed.ts`

修改后执行 `pnpm -F @clawbot/server demo:seed` 重建（幂等，重复执行安全）。
