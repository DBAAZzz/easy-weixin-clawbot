# 微信登录态与账号凭据存储改造方案

## 背景

当前项目已经不是单机 CLI 工具，而是一个包含 Web 管理后台、Server 服务、PostgreSQL 持久化、定时任务、Webhook、MCP 管理和多账号运行时的完整服务端系统。

在这样的架构下，微信账号的登录态和账号凭据继续默认写入本地文件目录，例如 `OPENCLAW_STATE_DIR` 或 `~/.openclaw`，已经不再是最合适的方案。

本次文档整理了关于“登录态”相关的上下文、讨论结论、目标和推荐方案，作为后续实现时的统一依据。

## 当前实现现状

### 1. 微信登录成功后的凭据写入本地文件

当前 `weixin-agent-sdk` 在扫码登录成功后，会把以下信息写入本地状态目录：

- `accountId`
- `botToken`
- `baseUrl`
- `userId`

相关代码位置：

- `packages/weixin-agent-sdk/src/bot.ts`
- `packages/weixin-agent-sdk/src/auth/accounts.ts`
- `packages/weixin-agent-sdk/src/storage/state-dir.ts`

当前默认目录来源：

- `OPENCLAW_STATE_DIR`
- `CLAWDBOT_STATE_DIR`
- `~/.openclaw`

### 2. Server 运行时依赖本地凭据文件

服务端当前并不是从数据库读取微信账号凭据，而是通过 `@clawbot/weixin-agent-sdk` 的账号解析逻辑读取本地文件，再用于：

- 启动账号运行时
- 主动消息推送
- Webhook 消息发送

相关代码位置：

- `packages/server/src/runtime.ts`
- `packages/server/src/proactive-push.ts`
- `packages/server/src/webhooks/sender.ts`

### 3. allowFrom / pairing 授权关系也在文件中

当前扫码登录关联出来的用户授权关系仍然通过文件方式管理，而不是进入数据库。

相关代码位置：

- `packages/weixin-agent-sdk/src/auth/pairing.ts`

### 4. 登录等待态是进程内内存状态

二维码生成、扫码中、二维码过期、确认登录等过程，当前是进程内内存态，主要位于：

- `packages/weixin-agent-sdk/src/auth/login-qr.ts`
- `packages/server/src/login/login-manager.ts`

这一部分本质上是短生命周期运行态，不等同于长期持久凭据。

## 已讨论出的核心问题

### 1. 本地文件存储不适合当前服务端架构

项目已经使用 PostgreSQL 作为核心持久化层，但微信登录态和账号凭据仍然游离在数据库体系外，导致：

- Docker 部署时必须额外挂卷保存 `~/.openclaw`
- 容器重建或迁移时容易丢失登录凭据
- 运行依赖宿主机目录，和开源部署体验不一致
- 账号持久化能力分散在数据库和文件系统两套来源中

### 2. SDK 和应用层边界混淆

当前 `weixin-agent-sdk` 不只是协议 SDK，它还承担了：

- 账号凭据持久化
- 账号配置解析
- 本地状态目录管理

这会导致协议层和应用层职责耦合。更合理的边界应该是：

- SDK 负责协议交互和登录流程
- Server 负责凭据存储、读取、生命周期管理

### 3. “登录态”概念被混在一起

当前系统里，“登录态”实际上混合了三类东西：

1. 长期持久的账号凭据
2. 短期运行中的扫码过程状态
3. 进程级运行时连接状态

这三者生命周期和存储方式不同，不应统一处理。

### 4. 账号业务状态和凭据状态没有分层

当前运行时断开连接后会走 `deprecateAccount()` 之类的逻辑，容易把：

- 业务账号是否还存在
- 微信登录凭据是否失效
- 当前运行时是否在线

混成一个状态模型。

## 用户期望达到的目标

基于这次讨论，目标可以明确为以下几点：

1. 微信登录态和账号凭据不再默认依赖 `OPENCLAW_STATE_DIR` 或 `~/.openclaw`。
2. 既然系统已经有 PostgreSQL，就应让微信账号凭据进入数据库体系管理。
3. Docker 部署下，用户不需要再理解或维护额外的本地凭据目录。
4. Server 应成为微信凭据的唯一业务持有者，SDK 不再负责持久化。
5. 后续如果扩展为多实例部署，也要为账号租约和单实例占有做好设计预留。

## 讨论结论

结论不是“把所有登录相关状态都塞进数据库”，而是：

**将持久凭据数据库化，将短期运行态保留为运行时状态，并把 SDK 与存储职责解耦。**

换句话说：

- 应该入库的是长期持久且会被后续请求反复使用的账号凭据
- 不应该强制入库的是二维码等待扫码、当前 polling 过程、当前连接持有者这类短生命周期状态

## 推荐方案总览

建议采用以下整体架构：

### 1. `weixin-agent-sdk` 退回为无状态协议层

SDK 只负责：

- 发起扫码登录
- 轮询二维码状态
- 返回登录结果
- 使用显式传入的凭据进行消息收发

SDK 不再负责：

- 保存账号凭据到本地
- 从本地状态目录读取账号配置
- 解析默认账号
- 管理 `~/.openclaw` 下的微信登录凭据

### 2. `@clawbot/server` 成为凭据管理中心

Server 负责：

- 登录成功后的凭据持久化
- 凭据读取与解密
- 凭据生命周期管理
- 账号状态与凭据状态分层建模
- Webhook / 主动消息 / 运行时启动统一从 DB 取凭据

### 3. 数据库存储“持久凭据”和“授权关系”

推荐新增两类核心表。

#### `weixin_account_credentials`

建议字段：

- `account_id`
- `token_encrypted`
- `base_url`
- `user_id`
- `status`
- `last_login_at`
- `last_validated_at`
- `last_error`
- `key_version`
- `created_at`
- `updated_at`

字段含义：

- `token_encrypted`：加密后的 bot token，不存明文
- `status`：用于表达凭据状态，如 `active` / `invalid` / `expired` / `revoked` / `relogin_required`
- `key_version`：支持未来密钥轮换

#### `weixin_account_allow_from`

建议字段：

- `account_id`
- `wechat_user_id`
- `created_at`

用于替代当前文件里的 allowFrom 授权关系。

### 4. 持久凭据必须加密存储

bot token 后续还需要被取出调用微信接口，因此不能只做哈希存储，应该采用：

- 应用层加密后入库
- 运行时按需解密
- 主密钥来自环境变量或外部密钥管理系统

要求：

- 数据库中不保存明文 token
- 加密过程可支持未来密钥轮换
- 读取凭据必须经过 Server 内部受控路径

## 登录态分层设计

建议把“登录态”明确拆成三层：

### 1. 持久凭据态

这部分应该入库，代表账号长期可用性：

- bot token
- baseUrl
- userId
- allowFrom 授权
- 凭据是否有效

### 2. 登录流程态

这部分是扫码过程中短期存在的状态，可以保留在内存中，不必强制入库：

- 当前是否正在生成二维码
- 当前二维码是否已就绪
- 是否已扫码但未确认
- 当前二维码是否过期

这是一个典型的会话级、临时状态。

### 3. 运行时连接态

这部分是进程内运行状态，不属于持久凭据：

- 当前账号是否被本进程启动
- 当前是否在线
- 最近一次启动/断开原因

这部分可以暴露到运行监控，但不应与业务账号状态混为一谈。

## 为什么这套方案更合理

### 1. 与系统现有架构一致

项目已经使用 PostgreSQL 作为核心持久化层。微信账号凭据继续留在文件里，会导致系统出现两套事实来源：

- 数据库保存业务实体
- 文件系统保存关键凭据

这会增加部署复杂度，也让数据治理不一致。

### 2. 更适合 Docker 和开源部署

数据库化后，部署模型更清晰：

- PostgreSQL 负责结构化业务数据和微信凭据
- `data/` 继续负责缓存类文件
- 不再需要为了登录凭据专门维护 `~/.openclaw`

这样 Docker Compose 也更容易标准化。

### 3. 职责边界更清晰

协议 SDK 不应拥有业务持久化逻辑。把存储责任收回到 Server 后：

- SDK 更纯粹
- Server 更可控
- 后续更容易做测试、审计和权限治理

### 4. 为多实例扩展预留空间

一旦未来支持多实例部署，凭据必须先入库，才有可能在其上继续做：

- 账号租约
- 单账号单实例占有
- 故障转移
- 凭据轮换

## 不建议的做法

以下方案不推荐：

### 1. 继续以文件为主，只是给 Docker 挂卷

这只能缓解部署问题，不能解决架构边界问题。根因仍然存在：

- 凭据仍然脱离数据库
- Server 仍然依赖宿主机状态目录
- SDK 仍然承担持久化职责

### 2. 把所有登录过程状态也写进数据库

二维码等待扫码、轮询中、短期扫码上下文这类状态本质上是临时流程态，不需要强行入库。否则会：

- 增加状态同步复杂度
- 引入大量无价值短期记录
- 让实现变重

### 3. 直接把 token 明文入库

这不符合基本安全要求。即使是内部系统，也不应该把微信 bot token 以明文形式持久化在数据库中。

## 推荐的迁移思路

建议按阶段演进，而不是一次性重写。

### 第一阶段：建立数据库凭据模型

- 在 Prisma schema 中新增微信凭据表和 allowFrom 表
- 在 Server 中增加 `WeixinCredentialStore`
- Server 登录成功后，先把凭据写库

### 第二阶段：Server 改为从 DB 取凭据

- `runtime.ts` 从数据库读取账号凭据
- `proactive-push.ts` 从数据库读取账号凭据
- `webhooks/sender.ts` 从数据库读取账号凭据

### 第三阶段：SDK 去持久化

- `weixin-agent-sdk` 不再导出文件型账号解析能力
- `saveWeixinAccount()` / `resolveWeixinAccount()` 逐步退场
- SDK 仅保留登录流程与显式参数驱动的收发消息能力

### 第四阶段：清理遗留文件状态依赖

- 删除 `OPENCLAW_STATE_DIR` 下微信凭据依赖
- allowFrom 完全切到数据库
- 仅保留真正需要文件系统的缓存内容

## 对 Docker 架构的影响

采用本方案后，Docker 化会明显更合理：

- `postgres`：持久化业务数据和微信凭据
- `server`：读取 DB 中的加密凭据并运行
- `nginx`：托管 Web 并反代 `/api`

此时挂卷主要保留给：

- PostgreSQL 数据卷
- `data/downloads`
- `data/media-cache`
- `data/tts-cache`

而不是再强依赖 `~/.openclaw` 这类宿主机目录。

## 未来扩展建议

如果后续要支持多实例部署，建议在数据库化凭据之后继续补上：

### 1. 账号运行租约

增加类似 `account_runtime_lease` 的机制，保证同一微信账号同一时间只被一个 Server 实例占有。

### 2. 凭据健康检查

定期验证 token 是否仍可用，并更新 `weixin_account_credentials.status`。

### 3. 凭据轮换与审计

记录：

- 最近一次登录时间
- 最近一次失败原因
- 最近一次人工重新授权时间
- 加密密钥版本

## 最终建议

本次讨论后的最佳结论是：

**把微信“持久登录凭据”收回数据库管理，把“扫码中的临时登录流程态”继续保留为运行时状态，并让 `weixin-agent-sdk` 回归无状态协议层。**

这套方案同时解决了：

- 当前本地状态目录不合理的问题
- Docker 部署不够标准的问题
- SDK 与应用层职责混淆的问题
- 后续多实例扩展缺乏基础的问题

相比“继续文件挂卷”或“简单把 token 搬进 DB”这类半步方案，这个方案更完整，也更符合当前项目已经演进到的系统形态。
---

## 代码审查补充（2026-04-19）

> 以下内容基于对文档所涉及的全部代码文件的逐行审查后新增，不修改上方已有方案文本。目的是补全文档未覆盖的盲区、纠正与代码实际不符的假设、补充关键实施细节。

### 补充一：`Account` 表已存在，新增 `weixin_account_credentials` 表需明确与之的关系

上方方案建议新增 `weixin_account_credentials` 表，但当前 Prisma schema 中 **已有 `Account` 模型**（`packages/server/prisma/schema.prisma`），包含 `id`、`displayName`、`alias`、`deprecated`、`createdAt`，并且已被 `Conversation`、`Message`、`TapeEntry` 等多张表外键关联。

这里需要做一个明确的架构决策：

**方案 A：在现有 `Account` 表上扩展凭据字段**

优点：无需 JOIN，查询简单；`Account` 本身就是 1:1 对应微信账号
缺点：凭据字段（加密 token）和业务字段混在同一行，不利于最小权限访问控制

**方案 B：新建 `weixin_account_credentials` 表，1:1 FK 指向 `Account.id`**

优点：凭据数据与业务数据物理隔离，便于审计和权限控制
缺点：多一次 JOIN；需保证两表一致性

**建议采用方案 B**，理由：

1. 凭据表可以设置更严格的数据库级别 Row-Level Security 或列级权限
2. 凭据生命周期（过期/轮换）和业务实体生命周期（创建/删除）不同
3. 后续若支持一个 Account 绑定多种凭据类型（如 bot token + OAuth token），方案 B 更容易扩展

补充的建议 schema：

```prisma
model WeixinAccountCredential {
  id              BigInt   @id @default(autoincrement())
  accountId       String   @unique @map("account_id") @db.Text
  tokenEncrypted  Bytes    @map("token_encrypted")       // AES-256-GCM 加密后的 bot token
  tokenIv         Bytes    @map("token_iv")               // 每次加密独立 IV
  tokenAuthTag    Bytes    @map("token_auth_tag")         // GCM auth tag
  baseUrl         String   @map("base_url") @db.Text
  userId          String?  @map("user_id") @db.Text       // 扫码用户 ID
  status          String   @default("active") @db.Text    // active | invalid | expired | revoked | relogin_required
  keyVersion      Int      @default(1) @map("key_version")
  lastLoginAt     DateTime? @map("last_login_at") @db.Timestamptz(6)
  lastValidatedAt DateTime? @map("last_validated_at") @db.Timestamptz(6)
  lastError       String?   @map("last_error") @db.Text
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  account         Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@map("weixin_account_credentials")
}
```

与上方文档建议的区别：增加了 `tokenIv` 和 `tokenAuthTag` 字段，因为 AES-256-GCM 需要独立 IV 和认证标签。这些不应与密文拼接后存为单一 blob，分开存储更利于密钥轮换时的批量重加密。

### 补充二：`deprecated` 字段的滥用必须在本次迁移中修正

当前代码 `packages/server/src/runtime.ts` 中：

```typescript
// 非主动中止 → 连接被新扫码顶替，标记为废弃
if (!abortController.signal.aborted) {
  await deprecateAccount(accountId);
}
```

这意味着 **bot 断开连接 = 账号被标记为 deprecated**。但 `deprecated` 的语义应该是"业务层面此账号不再使用"，而不是"运行时连接丢失"。当前逻辑会导致：

- 网络抖动断连 → 账号被标记 deprecated → 重启后不会自动恢复
- `getActiveAccountIds()` 查询 `deprecated: false`，断连账号不会被 bootstrap 重新拉起

建议在本次迁移中将 `Account` 模型拆分出运行时状态：

```
Account.deprecated     → 保留，仅表示"业务层面弃用"
Credential.status      → 表示凭据是否有效（active / invalid / expired）
运行时在线状态         → 保留在内存 Map（之前方案的第三层），不入库
```

`runtime.ts` 中的断连逻辑应改为：更新 `WeixinAccountCredential.status = 'relogin_required'`，而不是 `deprecated = true`。这样 bootstrap 时依然可以尝试拉起该账号（使用已有凭据重试连接），只有在凭据确认失效后才标记为 `invalid`。

### 补充三：`sync-buf`（消息同步缓冲）是文档未提及的第四类文件状态

`packages/weixin-agent-sdk/src/monitor/monitor.ts` 使用 `loadGetUpdatesBuf()` / `saveGetUpdatesBuf()`（来自 `storage/sync-buf.ts`）在文件系统中持久化 `get_updates_buf` 值。这个值是微信长轮询的断点续传游标，丢失它会导致重启后重复接收或漏接消息。

分层归属：**sync-buf 是"持久运行态"，而非上方方案归类的"短期运行态"。** 它的特征是：

- 生命周期长于进程，短于凭据
- 每次 getUpdates 响应都可能更新
- 丢失后果：消息重复 / 消息丢失

建议处理方式：

1. 将 `sync_buf` 加入 `weixin_account_credentials` 表或独立为一张轻量表（`weixin_sync_state`）
2. 理由：Docker 重建容器后，sync buf 必须恢复，否则消息可靠性受损
3. 更新频率高，建议使用 `UPDATE ... SET sync_buf = $1 WHERE account_id = $2`，不走 Prisma ORM 而直接用 `$executeRaw` 以减少开销

### 补充四：`login-manager.ts` 的 stdout 劫持是 SDK 接口设计缺陷

当前 `packages/server/src/login/login-manager.ts` 通过 `captureStdout()` 劫持 `process.stdout.write` 来拦截 SDK `login()` 函数打印的终端二维码文本（`qr-capture.ts`）。这是一个极其脆弱的模式：

- 依赖 `qrcode-terminal` 的输出格式不变
- 多个并发登录会互相干扰 stdout 捕获
- 任何第三方库的 stdout 输出都可能被误截

**根因**：SDK 的 `login()` 函数将"执行登录流程"和"渲染 QR 到终端"耦合在一起，没有提供结构化的 QR 数据回调。

建议在第三阶段（SDK 去持久化）中同步解决：

```typescript
// SDK 应提供结构化的登录事件回调
export type LoginEvents = {
  onQrReady?: (data: { qrcodeUrl: string; qrcodeRaw: string }) => void;
  onScanned?: () => void;
  onConfirmed?: (result: LoginResult) => void;
  onExpired?: () => void;
};

export async function loginWithEvents(opts: LoginOptions & LoginEvents): Promise<LoginResult> {
  // ... 返回结构化结果，不直接 console.log
}
```

这样 `login-manager.ts` 可以直接接收结构化数据，无需劫持 stdout。

### 补充五：`allowFrom` 在 Server 侧完全未使用

代码搜索确认，`registerUserInAllowFromStore` 和 `readFrameworkAllowFromList` 在 `packages/server/` 中 **零引用**。这意味着：

1. **allowFrom 授权检查目前可能根本没有在 Server 生产路径中执行**，或者
2. 它只在 SDK 内部的 `processOneMessage()` 消息处理链中使用

如果是情况 2，那么将 allowFrom 迁移到数据库后，SDK 的消息处理函数需要能从外部注入授权检查逻辑（Port/Adapter 模式），而不是自己读文件。

建议在迁移中增加：

```typescript
// agent/interface.ts 或 monitor opts 中增加
export type AuthorizationCheck = (accountId: string, fromUserId: string) => Promise<boolean>;
```

SDK `processOneMessage()` 通过该回调询问 Server 当前用户是否在授权名单内，Server 查 DB 实现。

### 补充六：`routeTag` 配置依赖也需要脱离文件系统

`packages/weixin-agent-sdk/src/api/api.ts` 的 `buildCommonHeaders()` 在每次请求时调用 `loadConfigRouteTag()`，该函数从 `openclaw.json`（位于状态目录）读取路由标签并设置为 HTTP 请求头。

这是又一个文件系统依赖。建议：

- `routeTag` 应作为 `MonitorWeixinOpts` 和 API 调用函数的显式参数传入
- Server 启动时从配置文件或数据库读取一次，通过参数传递给 SDK
- SDK 不应自行读取配置文件

这应列入第三阶段（SDK 去持久化、去文件依赖）的改造清单。

### 补充七：Token 加密技术方案应明确

上方文档提出"应用层加密后入库"但未给出技术细节。对于安全关键路径，补充具体建议：

**推荐方案：AES-256-GCM + 环境变量主密钥**

```
加密：
  plaintext = botToken (UTF-8)
  key       = HKDF-SHA256(masterKey, salt="clawbot-credential-v1", info=accountId)
  iv        = crypto.randomBytes(12)  // 每次加密独立 IV
  { ciphertext, authTag } = AES-256-GCM(key, iv, plaintext)

存储：
  token_encrypted = ciphertext
  token_iv        = iv
  token_auth_tag  = authTag
  key_version     = 当前密钥版本号

解密：
  从 DB 读取 ciphertext + iv + authTag
  用相同 HKDF 派生 key
  AES-256-GCM.decrypt(key, iv, ciphertext, authTag)
```

**主密钥管理**：

- 环境变量 `CLAWBOT_CREDENTIAL_KEY`（必须为 32 字节 hex 或 base64）
- 生产环境建议对接 KMS（如 AWS KMS、HashiCorp Vault 的 Transit 引擎）
- `key_version` 字段支持轮换：新版密钥加密新凭据，旧凭据按需迁移

**为什么不用 AES-256-CBC**：GCM 提供认证加密（AEAD），可发现篡改，CBC 需要额外的 HMAC 层。

### 补充八：现有安装的数据迁移路径

文档的四阶段迁移计划缺少对已有安装的数据迁移。对于已经在 `~/.openclaw` 中存有凭据的用户：

**建议增加"阶段 0：数据迁移"：**

1. Server 启动时检测是否存在 `weixin_account_credentials` 表中无记录但文件系统有凭据的账号
2. 自动执行一次性迁移：读取文件凭据 → 加密 → 写入 DB → 在文件中标记已迁移
3. 迁移成功后文件内容保留但标记为 `{ migrated: true }`，避免回退困难
4. 提供 CLI 命令 `pnpm -F @clawbot/server migrate:credentials` 支持手动触发
5. 连续 2 个版本后，删除文件读取兼容代码

### 补充九：`weixin-acp` 包的影响评估

工作区中存在 `packages/weixin-acp/`，它实现了 ACP（Agent Client Protocol）→ weixin-agent-sdk Agent 接口的适配器。该包：

- 依赖 `@clawbot/weixin-agent-sdk` 的 `Agent` 类型接口
- 不直接访问凭据或文件系统
- 不受本次迁移影响

但 `packages/weixin-acp/main.ts`（CLI 入口）可能直接使用了 SDK 的 `login()` / `start()`，这些函数在第三阶段改造后会变化。应在迁移计划中备注：**weixin-acp CLI 场景需保留一个"无 Server 模式"的 SDK 兼容层，或明确 weixin-acp 必须通过 Server 运行。**

### 补充十：Server 处 bootstrap 和 SDK 凭据读取的混合来源问题

当前 `runtime.ts` 的 bootstrap 流程存在一个微妙的混合来源问题：

```
1. getActiveAccountIds()       → 从 PostgreSQL 读取（DB 来源）
2. start(agent, { accountId }) → 内部调用 resolveWeixinAccount(accountId)
                                → 从 ~/.openclaw 文件读取凭据（文件来源）
```

这意味着：

- DB 中标记为 active 但文件中无凭据 → 启动失败（`configured: false`）
- 文件中有凭据但 DB 中无记录 → 该账号不会被 bootstrap 拉起

**第二阶段的改造必须同时修改 `runtime.ts` 和 `monitorWeixinProvider` 的凭据来源**。建议的 `launchAccount` 改造：

```typescript
async function launchAccount(accountId: string, abortController: AbortController) {
  const credential = await credentialStore.getDecrypted(accountId);
  if (!credential || credential.status !== 'active') {
    log.warn(`Account ${accountId} has no valid credential, skipping`);
    return;
  }

  await monitorWeixinProvider({
    baseUrl: credential.baseUrl,
    token: credential.token,     // 已解密的明文 token
    accountId,
    agent: createAgent(accountId),
    abortSignal: abortController.signal,
  });
}
```

关键变化：不再调用 SDK 的 `start()` 函数（该函数内部读文件），而是直接调用更底层的 `monitorWeixinProvider()`，凭据由 Server 从 DB 取出并解密后显式传入。

### 补充十一：登录成功后的完整写入链路需要重新设计

当前登录成功写入链路（`login-manager.ts` → SDK `login()` → `saveWeixinAccount()` + `registerWeixinAccountId()`）存在双重写入问题。改造后建议的完整链路：

```
1. login-manager 调用 SDK 的 loginWithEvents()（纯协议，不保存）
2. SDK 返回 { botToken, accountId, baseUrl, userId }
3. login-manager 将凭据加密后写入 weixin_account_credentials 表
4. login-manager 将 accountId upsert 到 Account 表
5. login-manager 将 userId 写入 weixin_account_allow_from 表
6. login-manager 调用 runtime.ensureAccountStarted(accountId)
7. runtime 从 DB 取出凭据，传入 monitorWeixinProvider 启动轮询
```

这条链路确保凭据从 SDK 出来后只有一个写入路径（Server → DB），且 SDK 全程无文件 IO。

### 补充十二：修订后的迁移阶段总览

综合上述补充，建议的完整迁移阶段为：

| 阶段 | 内容 | 涉及包 |
|------|------|--------|
| 阶段 0 | 数据迁移：文件凭据 → DB（向下兼容） | server |
| 阶段 1 | 建立 DB 凭据模型 + 加密模块 + allowFrom 表 + sync_state 表 | server |
| 阶段 2 | Server 全链路改为从 DB 取凭据（runtime / push / webhook / scheduler） | server |
| 阶段 3 | SDK 去持久化 + 登录事件回调 + routeTag 参数化 + allowFrom 回调注入 | weixin-agent-sdk |
| 阶段 4 | 清理遗留文件依赖 + weixin-acp 适配 | server, weixin-agent-sdk, weixin-acp |