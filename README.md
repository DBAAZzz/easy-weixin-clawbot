<div align="center">
  <h1>微信 ClawBot Agent</h1>
  <p>多账号微信 AI Agent 管理平台。</p>
  <div align="center">
    <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version" />
    <img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="License" />
    <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node" />
    <img src="https://img.shields.io/badge/pnpm-%3E%3D10-orange" alt="Pnpm" />
  </div>
</div>

微信 ClawBot Agent 用来把多个微信号接入为独立 AI Agent，并通过 Web 后台统一管理。当前推荐的生产部署方式是 Docker Compose。

## 为什么用它

- 多账号统一管理：一个后台查看、接入和运营多个微信 AI 账号
- 管理能力完整：账号、记忆、工具、技能、定时任务、Webhook、MCP 都有可视化入口
- 部署路径直接：基于 Docker Compose 启动，适合作为开源项目快速体验和落地
- 扩展方式清晰：支持工具、技能、Webhook 和 MCP Server 组合扩展

## 界面预览

<table>
  <tr>
    <td><img src="./images/账号管理.png" alt="账号管理" width="100%"></td>
    <td><img src="./images/记忆图谱.png" alt="记忆图谱" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>账号管理</strong></td>
    <td align="center"><strong>记忆图谱</strong></td>
  </tr>
  <tr>
    <td><img src="./images/工具列表.png" alt="工具列表" width="100%"></td>
    <td><img src="./images/技能列表.png" alt="技能列表" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>工具列表</strong></td>
    <td align="center"><strong>技能列表</strong></td>
  </tr>
  <tr>
    <td><img src="./images/运行监控trace.png" alt="运行监控" width="100%"></td>
    <td><img src="./images/定时任务.png" alt="定时任务" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>运行监控 Trace</strong></td>
    <td align="center"><strong>定时任务</strong></td>
  </tr>
  <tr>
    <td><img src="./images/webhook.png" alt="Webhook" width="100%"></td>
    <td><img src="./images/MCP服务.png" alt="MCP 服务" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>Webhook</strong></td>
    <td align="center"><strong>MCP 服务</strong></td>
  </tr>
</table>

## 快速部署

```bash
git clone https://github.com/DBAAZzz/easy-weixin-clawbot.git
cd easy-weixin-clawbot

cp .env.example .env
# 编辑根目录 .env
docker compose up --build -d
```

启动前至少需要补这几项配置：

- `.env`：`POSTGRES_PASSWORD`
- `.env`：`CLAWBOT_CREDENTIAL_KEY`
- `.env`：一组可用的 LLM Key，例如 `LLM_API_KEY` 或对应 provider 的 API Key
- `.env`：`AUTH_USERNAME`、`AUTH_PASSWORD`、`AUTH_JWT_SECRET`

生成 `CLAWBOT_CREDENTIAL_KEY`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

默认访问地址：

- Web 管理后台：[http://localhost](http://localhost)
- API 健康检查：[http://localhost:8028/api/health](http://localhost:8028/api/health)

常用命令：

```bash
docker compose logs -f server
docker compose ps
docker compose down
```

更完整的部署说明见 [docs/readme/docker-deployment.md](./docs/readme/docker-deployment.md)。

## 配置约定

项目现在只保留一个配置入口：仓库根目录 `.env`。

- 只保留一个示例文件：`.env.example`
- `packages/server` 不再使用 `packages/server/.env`
- 后台登录鉴权不再使用 `packages/server/config.yaml`
- Agent 默认 system prompt 直接内置在 `packages/agent/prompts/`
- `packages/web` 开发服务器也会从根目录 `.env` 读取环境变量，并自动根据 `API_PORT` 代理 `/api`
- Docker Compose 和源码开发都使用同一个 `.env`，只是在数据库区块填写不同变量

本地开发时：

```bash
cp .env.example .env
# 编辑根目录 .env
pnpm install
pnpm dev
```

## 文档

- [Docker 部署](./docs/readme/docker-deployment.md)
- [多账号与微信登录](./docs/readme/multi-account-and-login.md)
- [记忆、工具、技能、定时任务](./docs/readme/memory-tools-and-automation.md)
- [Webhook、MCP、可观测性](./docs/readme/integrations-and-observability.md)
- [本地源码开发](./docs/readme/source-development.md)
- [更多架构文档](./docs/)

## License

GPL-3.0
