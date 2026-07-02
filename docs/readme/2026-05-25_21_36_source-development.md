# 本地源码开发

Docker 是默认部署方式。这个文档只面向需要参与源码开发的贡献者。

## 环境要求

- Node.js >= 22
- pnpm >= 10
- PostgreSQL

## 初始化

```bash
cp .env.example .env
# 编辑根目录 .env
pnpm install
```

然后补齐：

- `.env` 里的数据库和模型配置
  本地源码开发时，数据库只支持 `DATABASE_URL` 和 `DIRECT_URL`
- `.env` 里的后台登录配置：`AUTH_USERNAME`、`AUTH_PASSWORD`、`AUTH_JWT_SECRET`

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

## 静态资源

本地开发默认把长期资产写入 `data/assets`。如需改成本机其他目录或 S3-compatible 对象存储，启动后在后台 `设置 -> 资产存储` 中配置。

本地迁移脚本会读取 `.env` 中的 `ASSET_S3_*` 配置，详见 [静态资源与资产存储](./2026-05-25_21_36_asset-storage.md)。

## 继续阅读

- [docs/2026-04-01_17_39_agent-architecture.md](../2026-04-01_17_39_agent-architecture.md)
- [docs/2026-04-23_19_23_web-architecture.md](../2026-04-23_19_23_web-architecture.md)
- [docs/2026-04-21_00_11_jwt-authentication.md](../2026-04-21_00_11_jwt-authentication.md)
- [静态资源与资产存储](./2026-05-25_21_36_asset-storage.md)
