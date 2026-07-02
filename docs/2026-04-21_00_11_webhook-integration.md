# Webhook 集成方案

## 概述

业务系统通过 Webhook 接口向指定微信账号推送消息，实现外部系统与微信的集成。

### 前置依赖

> ✅ `weixin-agent-sdk` 已支持主动发送消息能力：
> - SDK 导出 `sendMessageWeixin()` 函数
> - Server 实现 `sendProactiveMessage(accountId, conversationId, text)` 
> - 通过缓存的 contextToken（24小时有效）实现主动推送

## 核心设计

### 1. 架构模型

```
业务系统A ──webhook──┐
业务系统B ──webhook──┼──> Clawbot API ──> 多个微信账号
业务系统C ──webhook──┘
```

**特点：**
- 每个业务系统持有独立的 webhook token
- 一个 token 可授权访问多个微信账号
- 请求中指定目标账号和会话
- 自动校验会话有效性（contextToken 存在且未过期）
- 业务系统决定发送内容，Clawbot 负责投递

---

## API 设计

### 发送消息

```http
POST /api/webhooks
Authorization: Bearer <webhook_token>
Content-Type: application/json

{
  "accountId": "bebcab7b0b6d-im-bot",
  "conversationId": "wxid_xxx",
  "text": "消息内容"
}
```

**参数说明：**
- `accountId`: 目标微信账号 ID（必填，需在 token 授权范围内）
- `conversationId`: 目标会话 ID（必填）
- `text`: 消息文本内容，最大 4000 字符

**请求头（可选）：**
- `Idempotency-Key`: 幂等键，用于防止网络重试导致的重复发送（如 UUID）

**响应：**
```json
{
  "success": true,
  "messageId": "msg_xxx"
}
```

**错误响应：**

| HTTP 状态码 | code | 说明 |
|-------------|------|------|
| 400 | `invalid_params` | 参数校验失败（text 为空、超长等） |
| 401 | `invalid_token` | Token 无效或已禁用 |
| 403 | `account_not_authorized` | Token 未授权访问该账号 |
| 404 | `conversation_not_found` | 会话不存在或 contextToken 已过期 |
| 429 | `rate_limited` | 超出频率限制，响应包含 `Retry-After` header |
| 503 | `account_offline` | 目标账号未登录/离线，无法投递 |

```json
{
  "error": "conversation_not_found",
  "message": "会话不存在或已过期（超过24小时未活跃），请用户先发送消息激活会话",
  "code": 404
}
```

> **投递模式说明：** 消息投递为同步模式 —— API 调用会等待微信侧发送完成后返回。
> 如果微信发送失败，响应中会携带错误信息，业务系统可根据 `Idempotency-Key` 安全重试。

---

## ~~废弃方案：URL 绑定账号~~

> ⚠️ **已废弃** - 以下设计已被上述多账号方案替代，保留此处仅供参考，避免错误实现。

<details>
<summary>点击查看废弃的 API 设计</summary>

```http
POST /api/webhooks/:accountId
Authorization: Bearer <webhook_token>
Content-Type: application/json

{
  "conversationId": "wxid_xxx",
  "text": "消息内容"
}
```

**废弃原因：**
- Webhook URL 与账号 ID 强绑定，灵活性差
- 业务系统需要为每个账号维护不同的 webhook URL
- 无法实现一个 token 管理多个账号的场景

</details>

---

## 数据库设计

### webhook_tokens 表

> Token 安全策略：数据库仅存储 token 的 SHA-256 哈希值，明文 token 仅在创建时返回一次。
> Token 生成规范：使用 `crypto.randomBytes(32)` 生成，添加 `whk_` 前缀便于识别和日志脱敏。

```sql
CREATE TABLE webhook_tokens (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL UNIQUE,  -- 业务系统标识，如 'order-system'
  token_hash TEXT NOT NULL,      -- token 的 SHA-256 哈希值（不存储明文）
  token_prefix TEXT NOT NULL,    -- token 前 8 位，用于管理界面展示（如 'whk_a3f2...'）
  description TEXT,              -- 业务系统描述
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_webhook_tokens_hash ON webhook_tokens(token_hash);
```

### webhook_account_permissions 表

> 账号授权表：定义每个 webhook token 可以访问哪些微信账号。

```sql
CREATE TABLE webhook_account_permissions (
  token_id BIGINT NOT NULL,
  account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (token_id, account_id),
  FOREIGN KEY (token_id) REFERENCES webhook_tokens(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_permissions_account ON webhook_account_permissions(account_id);
```

> **Prisma 对齐提醒：** 实际实现需在 `schema.prisma` 中定义对应模型，通过 Prisma Migration 管理表结构。

### webhook_logs 表

> 投递日志为生产必备能力，业务系统排查问题时强依赖，已提升至 Phase 1。

```sql
CREATE TABLE webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  token_id BIGINT NOT NULL,
  account_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,         -- 'success', 'failed', 'rejected'
  error TEXT,
  idempotency_key TEXT,         -- 调用方传入的幂等键
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (token_id) REFERENCES webhook_tokens(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_logs_token ON webhook_logs(token_id, created_at DESC);
CREATE INDEX idx_webhook_logs_account ON webhook_logs(account_id, created_at DESC);
CREATE INDEX idx_webhook_logs_idempotency ON webhook_logs(idempotency_key) WHERE idempotency_key IS NOT NULL;
```

---

## 使用示例

### 1. 订单系统推送

```bash
curl -X POST https://your-domain/api/webhooks \
  -H "Authorization: Bearer whk_order_system_token_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "bebcab7b0b6d-im-bot",
    "conversationId": "o9cq801OSzfX7lbV6zWh4Ad_G5Wo@im.wechat",
    "text": "新订单通知\n订单号：#12345\n金额：¥999\n客户：张三"
  }'
```

### 2. 告警系统推送

```bash
curl -X POST https://your-domain/api/webhooks \
  -H "Authorization: Bearer whk_alert_system_token_xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "bebcab7b0b6d-im-bot",
    "conversationId": "o9cq801OSzfX7lbV6zWh4Ad_G5Wo@im.wechat",
    "text": "🚨 告警通知\n服务器：web-01\nCPU 使用率：95%\n时间：2026-03-27 10:30"
  }'
```

### 3. 多账号场景

同一个 token 可以向不同账号发送消息（需预先授权）：

```bash
# 发送到账号 A
curl -X POST https://your-domain/api/webhooks \
  -H "Authorization: Bearer whk_crm_system_token_def456" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "account-a-im-bot",
    "conversationId": "wxid_customer_001",
    "text": "您的工单已处理完成"
  }'

# 发送到账号 B
curl -X POST https://your-domain/api/webhooks \
  -H "Authorization: Bearer whk_crm_system_token_def456" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "account-b-im-bot",
    "conversationId": "wxid_customer_002",
    "text": "您的工单已处理完成"
  }'
```

---

## 管理接口

### 创建 Webhook Token

```http
POST /api/webhooks/tokens
Authorization: Bearer <api_secret>

{
  "source": "order-system",
  "description": "订单系统 Webhook",
  "accountIds": ["bebcab7b0b6d-im-bot", "another-account-im-bot"]
}
```

**响应：**
```json
{
  "token": "whk_abc123xyz789...",
  "source": "order-system",
  "accountIds": ["bebcab7b0b6d-im-bot", "another-account-im-bot"],
  "enabled": true,
  "createdAt": "2026-03-27T10:00:00Z"
}
```

> ⚠️ `token` 明文仅在此响应中返回一次，后续无法再次获取。请妥善保存。

### 列出 Webhook Tokens

```http
GET /api/webhooks/tokens
Authorization: Bearer <api_secret>
```

**响应：**
```json
{
  "data": [
    {
      "source": "order-system",
      "tokenPrefix": "whk_abc123...",
      "accountIds": ["bebcab7b0b6d-im-bot"],
      "enabled": true,
      "createdAt": "2026-03-27T10:00:00Z",
      "lastUsedAt": "2026-03-27T10:30:00Z"
    }
  ]
}
```

### 更新账号授权

添加或移除 token 可访问的账号：

```http
PATCH /api/webhooks/tokens/:source/accounts
Authorization: Bearer <api_secret>

{
  "add": ["new-account-im-bot"],
  "remove": ["old-account-im-bot"]
}
```

### 禁用/启用 Token

```http
PATCH /api/webhooks/tokens/:source
Authorization: Bearer <api_secret>

{
  "enabled": false
}
```

### 轮换 Token

生成新 token 替换旧 token，旧 token 立即失效：

```http
POST /api/webhooks/tokens/:source/rotate
Authorization: Bearer <api_secret>
```

**响应：**
```json
{
  "token": "whk_new_token...",
  "source": "order-system",
  "accountIds": ["bebcab7b0b6d-im-bot"],
  "rotatedAt": "2026-03-27T12:00:00Z"
}
```

### 删除 Token

```http
DELETE /api/webhooks/tokens/:source
Authorization: Bearer <api_secret>
```

### 查询调用日志

业务系统可查询自己的投递历史：

```http
GET /api/webhooks/tokens/:source/logs?limit=20
Authorization: Bearer <api_secret>
```

**响应：**
```json
{
  "data": [
    {
      "accountId": "bebcab7b0b6d-im-bot",
      "conversationId": "wxid_xxx",
      "status": "success",
      "createdAt": "2026-03-27T10:30:00Z"
    },
    {
      "accountId": "bebcab7b0b6d-im-bot",
      "conversationId": "wxid_yyy",
      "status": "failed",
      "error": "conversation_not_found",
      "createdAt": "2026-03-27T10:25:00Z"
    }
  ]
}
```

---

## 安全建议

1. **Token 管理**
   - Token 仅存储 SHA-256 哈希值，明文仅创建时返回一次
   - Token 使用 `whk_` 前缀，便于日志中识别和自动脱敏
   - 通过 `/rotate` 接口轮换 Token，旧 Token 立即失效
   - 记录 Token 使用日志（last_used_at）

2. **访问控制**
   - 账号授权：Token 仅能访问授权的账号列表
   - 会话有效性：检查 conversations 表中是否存在 contextToken（24小时有效）
   - 频率限制：默认 60 次/分钟/Token，使用滑动窗口算法
   - 超限返回 `429 Too Many Requests` + `Retry-After` header
   - 记录异常调用行为
   - 支持 IP 白名单（可选）

3. **消息验证**
   - 限制消息长度：4000 字符
   - `Idempotency-Key` 防重复投递（24 小时内同 key 返回缓存结果）
   - 会话存在性检查：必须在 conversations 表中存在且有有效 contextToken
   - 账号在线状态检查：投递前校验目标账号在线状态（90 秒心跳阈值）
   - 防止消息轰炸

4. **认证隔离**
   - 管理接口当前使用 JWT 登录认证（由仓库根 `.env` 中的 `AUTH_*` 环境变量驱动）
   - Webhook 投递接口使用独立的 `webhook_token` 认证
   - 两套认证通过不同中间件处理，路由注册时明确区分

---

## 扩展方向

### 1. 消息模板

支持预定义模板，简化业务系统调用：

```json
{
  "template": "order_notification",
  "data": {
    "orderNo": "12345",
    "amount": 999,
    "customer": "张三"
  }
}
```

### 2. 批量发送

支持一次调用发送到多个会话：

```json
{
  "conversations": ["wxid_001", "wxid_002"],
  "text": "群发消息内容"
}
```

### 3. 富文本消息

支持发送图片、文件等：

```json
{
  "type": "image",
  "url": "https://example.com/image.jpg"
}
```

---

## 实现优先级

**Phase 1（MVP）：**
- ✅ SDK 主动发送能力（`sendMessageWeixin` + `sendProactiveMessage`）
- ✅ contextToken 缓存机制（24小时有效期）
- ⬜ Webhook 基础接口（`POST /api/webhooks`）
- ⬜ Token 认证（SHA-256 哈希存储）
- ⬜ 多账号授权机制（webhook_account_permissions 表）
- ⬜ 会话有效性校验（检查 contextToken 是否存在）
- ⬜ 发送文本消息
- ⬜ 完整错误响应（400/401/403/404/429/503）
- ⬜ Webhook 投递日志
- ⬜ Prisma 模型定义 + Migration

**Phase 2：**
- ⬜ Token 管理接口（创建/列出/更新授权/禁用/轮换/删除）
- ⬜ 调用日志查询接口
- ⬜ 频率限制（滑动窗口，60次/分钟）
- ⬜ 幂等性支持（Idempotency-Key）
- ⬜ 账号在线状态校验

**Phase 3：**
- ⬜ 消息模板
- ⬜ 批量发送
- ⬜ 富文本消息
