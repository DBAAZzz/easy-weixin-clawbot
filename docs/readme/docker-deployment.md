# Docker 部署

这是当前推荐的生产部署方式。

## 架构

- `nginx`：提供 Web 静态资源，并把 `/api` 反代到服务端
- `server`：Hono API、多账号运行时、微信接入、调度器
- `postgres`：唯一数据库

微信登录态、凭据密文和同步状态都保存在数据库中，不再依赖本地 `~/.openclaw`。

## 快速启动

```bash
cp .env.example .env
# 编辑根目录 .env
docker compose up --build -d
```

## 必填配置

`.env` 至少补这些：

- `POSTGRES_PASSWORD`
- `CLAWBOT_CREDENTIAL_KEY`
- `AUTH_USERNAME`
- `AUTH_PASSWORD`
- `AUTH_JWT_SECRET`

说明：

- Docker Compose 启动时，会自动把容器内的 `DATABASE_URL` 和 `DIRECT_URL` 组装好
- 如果你不是用 Compose 自带 PostgreSQL，而是改接外部数据库，那么请直接在根 `.env` 里填写完整的 `DATABASE_URL` 和 `DIRECT_URL`
- LLM Provider 不通过 `.env` 配置；启动后请在 Web 管理后台的“模型配置”页面创建 Provider 模板和使用配置

生成 `CLAWBOT_CREDENTIAL_KEY`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 默认地址

- Web：[http://localhost](http://localhost)
- API Health：[http://localhost:8028/api/health](http://localhost:8028/api/health)
- PostgreSQL：`localhost:5432`

## 持久化

Docker Compose 会创建两个卷：

- `pgdata`：PostgreSQL 数据
- `appdata`：工具、技能、下载缓存、媒体缓存、TTS 缓存

其中微信登录态不在 `appdata`，而在 PostgreSQL。

## 常用命令

```bash
docker compose up -d
docker compose up --build -d
docker compose logs -f server
docker compose ps
docker compose down
```

## 继续阅读

- [多账号与微信登录](./multi-account-and-login.md)
- [docs/docker-deployment-architecture.md](../docker-deployment-architecture.md)
