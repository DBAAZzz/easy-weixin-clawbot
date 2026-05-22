# Asset 资产层架构方案

## 概述

Asset 层用于统一管理个人助理 Agent 在消息、记忆、报告和 Web 展示中产生或引用的图片、视频、音频和文件。它解决的问题不是“把所有资源都云端化”，而是提供一个稳定的资产引用模型，让上层只依赖 `assetId`，不直接依赖本机路径、对象存储 key 或具体云厂商。

默认实现必须保持个人部署友好：图片和文件存储在本地 `data/assets`。云对象存储仅作为可选 adapter，例如 Cloudflare R2、腾讯云 COS、阿里云 OSS、MinIO 或其他 S3-compatible 服务。

核心原则：

- `messages`、`reports`、`web` 只引用 `assetId`，不引用本地路径或对象存储 key。
- Asset 层可替换存储后端，默认 local，生产可选 object storage。
- 云厂商能力不侵入 Agent 主流程。
- 媒体资产是长期资料库的一部分，支撑每日、每周、每月、每年报告生成和 Web 查看。
- `weixin-agent-sdk` 只作为微信协议接入层，不决定 ClawBot 的长期资产存储规范。

---

## 1. 目标与非目标

### 1.1 目标

1. 支持消息图片、视频、音频、文件的统一入库与引用。
2. 支持 Web 后台通过 `assetId` 查看媒体资源。
3. 支持报告系统引用同一份资产，避免复制和路径耦合。
4. 默认本地存储，零云服务依赖。
5. 允许用户自行实现或选择 adapter，例如 Cloudflare R2、腾讯云 COS、阿里云 OSS。
6. 支持未来扩展缩略图、视频封面、OCR、图片理解、视频摘要等派生能力。

### 1.2 非目标

1. 不把项目改造成通用数字资产管理系统。
2. 不要求所有用户配置 OSS/R2。
3. 不在 `messages.payload` 中保存本地绝对路径作为长期引用。
4. 不让 `agent` 包直接依赖 Prisma、Hono、云厂商 SDK 或文件系统实现。
5. 不沿用 OpenClaw 的 `.openclaw` 目录作为本项目的资产或运行状态规范。

---

## 2. 和 weixin-agent-sdk 的边界

`weixin-agent-sdk` 来源于微信接入能力，历史上服务于 OpenClaw，因此代码中存在 `.openclaw`、`OPENCLAW_STATE_DIR`、`openclaw.json`、文件型 sync buf 等兼容逻辑。ClawBot 不需要遵循这些文件状态约定。

在本项目中，`weixin-agent-sdk` 的定位是 **Weixin Ingest Adapter**：

```text
weixin-agent-sdk
  负责：
    - getUpdates long polling
    - 接收微信消息
    - 下载微信 CDN 媒体
    - AES 解密
    - SILK 转码
    - 输出临时本地文件或消息文本

  不负责：
    - 长期资产存储
    - assets 表
    - 报告引用
    - Web 访问 URL
    - ClawBot 运行状态持久化
```

### 2.1 sync buf

`get_updates_buf` 是微信 long polling 的断点游标，不是媒体资产。它应该由 server 存储到数据库，例如当前的 `weixin_sync_state` 表。

架构要求：

- server 启动账号运行时时，从 DB 读取 sync buf。
- server 通过 `syncBufInitial` 传入 SDK。
- SDK 每次获得新 sync buf 后，通过 `onSyncBufUpdate` 回调交给 server。
- SDK 不再 fallback 到 `getSyncBufFilePath()` 或 `.openclaw` 文件。

```text
server DB weixin_sync_state
  ↓ syncBufInitial
monitorWeixinProvider()
  ↓ onSyncBufUpdate
server DB weixin_sync_state
```

去除文件 fallback 的原因：

- 分布式部署中本地文件不可共享。
- 文件 fallback 会制造隐式状态来源，增加排障难度。
- 当前项目已经有 DB 状态表，继续保留 fallback 会让状态权威不唯一。

### 2.2 微信媒体下载

`packages/weixin-agent-sdk/src/media/` 的职责是把微信 CDN 中的加密媒体转成临时可读文件：

```text
微信 CDN 媒体
  ↓ downloadMediaFromItem()
下载 / 解密 / 转码
  ↓
/tmp/weixin-agent/media/inbound/...
  ↓
ChatRequest.media.filePath
```

这些临时文件不是长期资产，只是 AssetService 的输入。ClawBot 的长期资产目录应是项目自己的 `data/assets`，不是 `.openclaw`，也不是 `/tmp/weixin-agent/media`。

### 2.3 OpenClaw 文件状态去除方向

后续代码清理应遵循：

- 删除 SDK 中 sync buf 的文件读写 fallback。
- 删除 SDK 对 `.openclaw` 目录的运行状态依赖。
- 删除 `openclaw.json` routeTag 读取逻辑，相关配置应由 server 显式传入。
- 删除文件型 allowFrom / pairing 状态，授权列表以 server DB 为准。
- 保留微信协议必要的 message id/channel 字符串时，应逐步改名为 ClawBot 语义，避免继续扩散 OpenClaw 命名。

---

## 3. 包边界设计

新增独立包：

```text
packages/
  asset/        -- 资产领域类型、接口、纯逻辑
  server/       -- Prisma 实现、Local/R2/COS/OSS adapter、HTTP API
  agent/        -- 生成消息时只携带 assetId
  web/          -- 通过 server API 展示资产
  shared/       -- 可选共享 API 类型
```

推荐依赖方向：

```text
server → asset → shared
web    → shared
agent  → shared
```

`agent` 是否直接依赖 `asset` 需要谨慎。第一阶段建议让 `agent` 只认识消息内容中的 `assetId` 字段，不直接调用 AssetService。资产创建、读取和 hydrate 由 `server` 侧的 MessageStore 实现处理。

`packages/asset` 只包含：

- 资产类型定义
- 存储引用类型
- store/service 接口
- key 生成、mime 分类等纯函数

`packages/asset` 不包含：

- Prisma Client
- Hono route
- Node 文件系统读写
- Cloudflare R2 / 腾讯云 / 阿里云 SDK
- 具体环境变量读取

---

## 4. 核心模型

### 4.1 AssetKind

```typescript
export type AssetKind = "image" | "video" | "audio" | "file";
```

### 4.2 AssetRecord

```typescript
export interface AssetRecord {
  id: string;
  accountId: string;
  kind: AssetKind;
  mimeType: string;
  sizeBytes?: number;
  sha256?: string;
  storage: AssetStorageRef;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: Date;
}
```

### 4.3 AssetStorageRef

```typescript
export type AssetStorageRef =
  | {
      provider: "local";
      path: string;
    }
  | {
      provider: "s3-compatible";
      bucket: string;
      key: string;
      endpoint?: string;
    }
  | {
      provider: "custom";
      name: string;
      ref: Record<string, unknown>;
    };
```

说明：

- `local.path` 是 server 内部路径，不直接暴露给 Web。
- `s3-compatible` 覆盖 Cloudflare R2、MinIO、AWS S3 以及兼容 S3 API 的服务。
- 腾讯云 COS、阿里 OSS 可以先通过兼容层接入；如需专有能力，再实现独立 adapter。
- `custom` 用于第三方或用户自定义 adapter，但 Web/API 层仍然只接触 `assetId`。

### 4.4 消息中的资产引用

消息 payload 不再存储 `filePath`，而是存储稳定的 `assetId`：

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "帮我看看这张图"
    },
    {
      "type": "image",
      "mimeType": "image/jpeg",
      "assetId": "asset_01HZ...",
      "data": ""
    }
  ]
}
```

报告系统也使用同一引用：

```json
{
  "type": "image",
  "assetId": "asset_01HZ...",
  "caption": "本周收到的晚餐照片"
}
```

---

## 5. Store 接口

### 5.1 AssetMetadataStore

负责资产元数据持久化。server 中由 Prisma 实现。

```typescript
export interface AssetMetadataStore {
  create(record: AssetRecord): Promise<void>;
  get(assetId: string): Promise<AssetRecord | null>;
  listByAccount(input: {
    accountId: string;
    kind?: AssetKind;
    limit: number;
    cursor?: string;
  }): Promise<{
    data: AssetRecord[];
    nextCursor?: string;
  }>;
  delete(assetId: string): Promise<void>;
}
```

### 5.2 AssetBlobStore

负责二进制内容读写。不同 adapter 实现此接口。

```typescript
export interface AssetBlobStore {
  put(input: {
    sourcePath: string;
    key: string;
    mimeType: string;
    metadata?: Record<string, string>;
  }): Promise<AssetStorageRef>;

  get(input: {
    ref: AssetStorageRef;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;

  delete(input: {
    ref: AssetStorageRef;
  }): Promise<void>;

  getAccessUrl?(input: {
    ref: AssetStorageRef;
    expiresInSeconds: number;
  }): Promise<string>;
}
```

### 5.3 AssetService

业务层组合 metadata store 和 blob store。

```typescript
export interface AssetService {
  createFromFile(input: {
    accountId: string;
    sourcePath: string;
    mimeType: string;
    kind?: AssetKind;
    conversationId?: string;
    messageSeq?: number;
  }): Promise<AssetRecord>;

  get(assetId: string): Promise<AssetRecord | null>;

  read(assetId: string): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;

  getAccessUrl(input: {
    assetId: string;
    expiresInSeconds: number;
  }): Promise<string>;
}
```

---

## 6. 数据库设计

新增 `assets` 表。它是资产唯一事实源，消息和报告只保存 `assetId`。

```prisma
model Asset {
  id          String   @id @db.Text
  accountId   String   @map("account_id") @db.Text
  kind        String   @db.Text
  mimeType    String   @map("mime_type") @db.Text
  sizeBytes   BigInt?  @map("size_bytes")
  sha256      String?  @db.Text
  provider    String   @db.Text
  bucket      String?  @db.Text
  objectKey   String?  @map("object_key") @db.Text
  localPath   String?  @map("local_path") @db.Text
  storageRef  Json?    @map("storage_ref")
  width       Int?
  height      Int?
  durationMs  Int?     @map("duration_ms")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  account     Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId, kind, createdAt], map: "idx_assets_account_kind_created")
  @@index([sha256], map: "idx_assets_sha256")
  @@map("assets")
}
```

字段说明：

- `provider`: `local`、`s3-compatible`、`custom` 等。
- `localPath`: 仅 local provider 使用。
- `bucket` / `objectKey`: 对象存储使用。
- `storageRef`: 为 custom adapter 或未来扩展保留。
- `sha256`: 用于去重、完整性校验和迁移验证。

---

## 7. 默认 Local Adapter

本地存储是默认实现，适合个人部署和开发环境。

推荐目录：

```text
data/assets/
  original/
    account-id/
      yyyy/
        mm/
          dd/
            asset-id.ext
  thumbnails/
    account-id/
      yyyy/
        mm/
          dd/
            asset-id.webp
```

Local adapter 行为：

1. 从临时文件复制到 `data/assets/original/...`。
2. 计算 `sha256`、`sizeBytes`、`mimeType`。
3. 返回 `AssetStorageRef { provider: "local", path }`。
4. Web 访问时不暴露 `path`，由 server 提供受控 API。

备份要求：

```text
必须同时备份：
  1. PostgreSQL 数据库
  2. data/assets 目录
```

---

## 8. Cloudflare R2 与对象存储 Adapter

第一版不需要单独设计 R2 抽象。Cloudflare R2 可以作为 `S3CompatibleAssetBlobStore` 的一个配置实例。

示例配置：

```typescript
{
  provider: "s3-compatible",
  name: "cloudflare-r2",
  endpoint: "https://<account-id>.r2.cloudflarestorage.com",
  region: "auto",
  bucket: "clawbot-assets",
  accessKeyId: "...",
  secretAccessKey: "...",
  publicBaseUrl: "https://assets.example.com"
}
```

R2 适用场景：

- 服务多实例部署。
- 容器本地磁盘不持久。
- Web 需要跨端稳定访问图片、视频和文件。
- 长期报告需要稳定引用资产。
- 大文件或视频不希望由 API 服务直接承载全部流量。

对象存储 adapter 行为：

1. 根据 `accountId`、日期、`assetId` 生成 object key。
2. 上传原始文件到 bucket。
3. 元数据写入 `assets` 表。
4. Web 展示时返回签名 URL、public URL，或走 server 代理。

---

## 9. 和 chat/messages 的集成

当前 `messages.ts` 中图片写入逻辑会剥离 base64 并保存 `filePath`。引入 Asset 层后，资产创建点应前移到 **server agent adapter 收到 `ChatRequest.media` 之后、调用 `chat()` 之前**。

这样 `messages.ts` 不再承担“归档媒体文件”的隐藏副作用，只负责持久化消息 payload。

### 9.1 入站媒体处理

```text
weixin-agent-sdk processOneMessage()
  ↓
下载微信 CDN 媒体，解密/转码
  ↓
ChatRequest.media.filePath     # 临时文件
  ↓
server agent adapter
  ↓
AssetService.createFromFile()
  ↓
得到 assetId
  ↓
调用 chat()，同时传入临时 filePath 和 assetId
```

chat 前创建 Asset 的原因：

- 入站媒体是用户原始资料，即使后续 LLM 调用失败，也应该可以被记录。
- 报告系统可以基于原始入站资产整理日报、周报、月报、年报。
- Asset 生命周期从消息序列化副作用变成明确的 ingest 步骤。
- `messages.ts` 不需要知道本地/R2/COS/OSS 的细节。

### 9.2 消息写入

```text
chat() 构造 AgentMessage
  ↓
message content 携带 assetId
  ↓
MessageStore.queuePersistMessage()
  ↓
serializeMessage()
  ↓
payload image block 写入 assetId，清空 data
  ↓
messages.payload 入库
```

新 payload：

```json
{
  "type": "image",
  "mimeType": "image/jpeg",
  "assetId": "asset_01HZ...",
  "data": ""
}
```

### 9.3 恢复 LLM 历史

```text
restoreHistory()
  ↓
hydrateMessage()
  ↓
发现 image block 带 assetId
  ↓
AssetService.read(assetId)
  ↓
按需恢复 base64 data
```

如果读取失败，降级为文本：

```text
[image unavailable: asset_01HZ...]
```

### 9.4 兼容旧数据

旧 payload 可能仍包含：

```json
{
  "type": "image",
  "stripped": true,
  "filePath": "/local/media-cache/xxx.jpg"
}
```

兼容策略：

1. 新写入只写 `assetId`。
2. 读取旧数据时继续尝试 `filePath`。
3. 提供迁移脚本扫描旧 `filePath`，创建 Asset，回写 payload。

---

## 10. 和 reports 的集成

报告系统不复制媒体文件，只引用 `assetId`。

日报、周报、月报、年报可以存结构化内容：

```json
{
  "title": "2026-05-22 日报",
  "blocks": [
    {
      "type": "paragraph",
      "text": "今天主要讨论了 Asset 层架构。"
    },
    {
      "type": "image",
      "assetId": "asset_01HZ...",
      "caption": "架构草图"
    }
  ]
}
```

收益：

- 报告不依赖本机路径。
- 本地存储迁移到 R2/COS/OSS 时，报告内容不需要改。
- Web、导出、摘要、搜索都能复用统一资产元数据。

---

## 11. Web API 设计

### 11.1 获取资产元数据

```http
GET /api/assets/:assetId
```

返回：

```json
{
  "id": "asset_01HZ...",
  "kind": "image",
  "mimeType": "image/jpeg",
  "sizeBytes": 123456,
  "width": 1024,
  "height": 768,
  "createdAt": "2026-05-22T10:00:00.000Z"
}
```

### 11.2 获取访问 URL

```http
GET /api/assets/:assetId/url
```

返回：

```json
{
  "url": "https://...",
  "expiresAt": "2026-05-22T10:10:00.000Z"
}
```

Local provider 可以返回 server 代理 URL：

```text
/api/assets/:assetId/content
```

Object provider 可以返回签名 URL 或 public CDN URL。

### 11.3 获取内容

```http
GET /api/assets/:assetId/content
```

用于 local provider 或需要后端鉴权代理的对象存储。视频和音频需要支持 HTTP Range。

---

## 12. 配置模型

第一阶段可以用 server 配置选择 active adapter。长期建议接入 Web 后台配置，符合项目中“运行时配置来自数据库”的方向。

```typescript
export type AssetStorageConfig =
  | {
      provider: "local";
      baseDir: string;
    }
  | {
      provider: "s3-compatible";
      name: string;
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      publicBaseUrl?: string;
    };
```

安全要求：

- access key 不进入前端。
- Web 只通过 server API 获取 URL。
- 私有 bucket 默认使用短期签名 URL。
- public bucket 需要用户明确开启。

---

## 13. 迁移路线

### Phase 0：清理 SDK 文件状态 fallback

1. 移除 `weixin-agent-sdk` 中 sync buf 的文件 fallback。
2. `monitorWeixinProvider` 要求调用方显式传入 DB 驱动的 sync buf 读写能力。
3. 移除 `.openclaw` 状态目录依赖。
4. routeTag、allowFrom、debug mode 等运行状态改由 server DB 或显式参数管理。

### Phase 1：本地 Asset 层

1. 新增 `packages/asset`。
2. 新增 `assets` 表。
3. 实现 `PrismaAssetMetadataStore`。
4. 实现 `LocalAssetBlobStore`。
5. 修改 server agent adapter：收到 `ChatRequest.media` 后，chat 前创建 Asset。
6. 修改 `chat()` / message 构造：图片消息携带 `assetId`。
7. 修改 `messages.ts`：payload 保存 `assetId`，不再保存新 `filePath`。
8. 读取时兼容旧 `filePath`。

### Phase 2：Web 展示能力

1. 新增 `/api/assets/:id`。
2. 新增 `/api/assets/:id/url`。
3. 新增 `/api/assets/:id/content`，支持 local 文件访问。
4. Web 消息列表和未来报告页面通过 `assetId` 展示媒体。

### Phase 3：S3-compatible / Cloudflare R2

1. 实现 `S3CompatibleAssetBlobStore`。
2. 提供 Cloudflare R2 配置示例。
3. 支持 object storage 签名 URL。
4. 增加旧 local asset 迁移到 object storage 的脚本。

### Phase 4：派生资产

1. 图片缩略图。
2. 视频封面。
3. OCR 文本。
4. 图片理解摘要。
5. 视频摘要和关键帧。

---

## 14. 设计取舍

| 方案 | 优点 | 缺点 | 结论 |
| ---- | ---- | ---- | ---- |
| 继续在 payload 存 filePath | 改动最小 | 分布式、迁移、Web 展示都脆弱 | 不适合作为长期方案 |
| 直接把图片存 DB | 简单、原子性好 | DB 膨胀，视频不可行 | 不推荐 |
| payload 存 objectKey | 比 filePath 稳定 | 仍然耦合存储后端 | 不推荐 |
| payload 存 assetId + assets 表 | 解耦、可迁移、可复用 | 初始改动稍大 | 推荐 |
| SDK 继续维护 `.openclaw` fallback | 兼容旧 OpenClaw 行为 | 状态权威不唯一，分布式不可控 | 不推荐 |
| server DB 显式管理运行状态 | 状态来源单一，部署可预测 | 需要清理 SDK 兼容代码 | 推荐 |

最终推荐：**Asset 是一层稳定领域抽象；默认 local，云存储只是可选 adapter。**
