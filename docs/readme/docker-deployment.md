# Docker 部署

这是当前推荐的生产部署方式。

## 架构

- `nginx`：提供 Web 静态资源，并把 `/api` 反代到服务端
- `server`：Hono API、多账号运行时、微信接入、调度器
- `postgres`：唯一数据库

微信登录态、凭据密文和同步状态都保存在数据库中，不再依赖本地 `~/.openclaw`。

## 快速启动

```bash
cp .env.docker.example .env
cp packages/server/config-example.yaml packages/server/config.yaml
# 编辑 .env 和 packages/server/config.yaml
docker compose up --build -d
```

## 必填配置

`.env` 至少补这些：

- `POSTGRES_PASSWORD`
- `CLAWBOT_CREDENTIAL_KEY`
- 一组可用的 LLM Key

生成 `CLAWBOT_CREDENTIAL_KEY`：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`packages/server/config.yaml` 至少补这些：

- `auth.username`
- `auth.password`
- `auth.jwtSecret`

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
