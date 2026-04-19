# 本地源码开发

Docker 是默认部署方式。这个文档只面向需要参与源码开发的贡献者。

## 环境要求

- Node.js >= 22
- pnpm >= 10
- PostgreSQL

## 初始化

```bash
cp packages/server/config-example.yaml packages/server/config.yaml
cp .env.example packages/server/.env
# 编辑 packages/server/.env
pnpm install
```

然后补齐：

- `packages/server/.env` 里的数据库和模型配置
- `packages/server/config.yaml` 里的后台登录配置

同步数据库 schema：

```bash
pnpm -F @clawbot/server prisma:push
```

## 常用命令

```bash
pnpm dev
pnpm dev:server
pnpm dev:web

pnpm build
pnpm test:server
pnpm test:agent
```

默认地址：

- Web 开发环境：[http://localhost:5173](http://localhost:5173)
- Server 开发环境：[http://localhost:8028](http://localhost:8028)

## 继续阅读

- [docs/agent-architecture.md](../agent-architecture.md)
- [docs/web-architecture.md](../web-architecture.md)
- [docs/jwt-authentication.md](../jwt-authentication.md)
