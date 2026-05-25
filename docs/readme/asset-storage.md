# 静态资源与资产存储

项目使用 Asset 资产层统一管理消息、记忆、报告和 Web 展示中引用的图片、视频、音频和文件。上层业务只保存稳定的 `assetId`，不直接依赖本机路径、对象存储 key 或具体云厂商。

## 能力边界

- 新收到的微信媒体会先由微信 SDK 下载到临时目录，再由 server 写入 Asset 长期存储
- 消息 payload 保存 `assetId`，Web 展示时再根据资产记录生成可访问地址
- 默认使用本地 `data/assets`，适合个人部署和 Docker Compose 快速启动
- 可切换到 Cloudflare R2、MinIO 或其他 S3-compatible 对象存储
- 旧资产仍按原记录读取；切换存储后，新资产写入新的存储后端

微信 SDK 的临时媒体目录不是长期资产目录：

- `packages/weixin-agent-sdk/.openclaw/media`：临时下载、解密、转码产物，可清理
- `data/assets` 或对象存储：长期资产存储，需要备份和迁移

## 管理入口

运行时配置入口在 Web 后台：

- `设置 -> 资产存储`

可配置项：

- Provider：`本地 data/assets` 或 `Cloudflare R2 / S3-compatible`
- 本地目录：留空时使用 `data/assets`
- S3-compatible：名称、Endpoint、Region、Bucket、Access Key ID、Secret Access Key
- Public Base URL：可选，配置公开域名后 Web 可直接使用 CDN URL；留空时由后端生成访问 URL

## 本地存储

本地存储是默认模式。未额外配置时，资产写入：

```text
data/assets/
```

Docker Compose 部署时，`data/assets` 位于 `appdata` 卷中。备份或迁移实例时，需要同时保留 PostgreSQL 数据和 `appdata` 卷。

如果要改成本机固定路径，可以在 `设置 -> 资产存储` 中填写本地目录。路径应使用 server 进程可访问的绝对路径；Docker 环境下需要额外挂载对应目录。

## S3-compatible 存储

对象存储适合多实例部署、远程访问或需要 CDN 的场景。当前运行时配置同样在 `设置 -> 资产存储` 中完成。

Cloudflare R2 常见配置：

```text
Provider: Cloudflare R2 / S3-compatible
名称: cloudflare-r2
Endpoint: https://<account-id>.r2.cloudflarestorage.com
Region: auto
Bucket: clawbot-assets
Access Key ID: <R2 access key id>
Secret Access Key: <R2 secret access key>
Public Base URL: https://assets.example.com
```

`Public Base URL` 可留空。留空时，系统会通过后端能力生成访问 URL；如果你已经为 bucket 配好了公开域名或 CDN，建议填写该域名。

## 数据模型

资产元数据保存在数据库 `assets` 表中，核心字段包括：

- `id`：资产 ID，即业务层引用的 `assetId`
- `account_id`：归属账号
- `kind`：`image`、`video`、`audio` 或 `file`
- `mime_type`、`size_bytes`、`sha256`
- `provider`、`local_path`、`bucket`、`object_key`

消息和报告只引用 `assetId`，不把长期本地绝对路径写入业务 payload。

## 迁移与脚本

如果已经使用本地存储，后续要迁移到 S3-compatible，可以使用迁移脚本：

```bash
pnpm -F @clawbot/server exec tsx src/assets/migrate-local-to-s3.ts --dry-run
pnpm -F @clawbot/server exec tsx src/assets/migrate-local-to-s3.ts
```

迁移脚本读取 `.env` 中的 S3 配置：

```text
ASSET_S3_ENDPOINT
ASSET_S3_REGION
ASSET_S3_BUCKET
ASSET_S3_ACCESS_KEY_ID
ASSET_S3_SECRET_ACCESS_KEY
ASSET_S3_PUBLIC_BASE_URL
```

建议先执行 `--dry-run`，确认待迁移数量和目标 key 后再正式迁移。

## 继续阅读

- [docs/asset-storage-architecture.md](../asset-storage-architecture.md)
- [docs/docker-deployment-architecture.md](../docker-deployment-architecture.md)
