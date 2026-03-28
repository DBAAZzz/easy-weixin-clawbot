# Webhook 集成方案

## 概述

业务系统通过 Webhook 接口向指定微信账号推送消息，实现外部系统与微信的集成。

### 前置依赖

> ⚠️ 当前 `weixin-agent-sdk` 仅提供请求-响应式的 `Agent.chat()` 接口，**不支持主动发送消息**。
> Webhook 方案依赖 SDK 暴露 `sendMessage(accountId, conversationId, content)` 能力。
> 在 SDK 实现该接口前，Webhook 路由可先占位注册，消息投递部分预留调用点。

## 核心设计

### 1. 架构模型

```
业务系统A ──webhook──┐
业务系统B ──webhook──┼──> Clawbot API ──> 微信账号
业务系统C ──webhook──┘
```

**特点：**
- 每个业务系统持有独立的 webhook token
- Webhook URL 直接绑定到账号 ID
- 业务系统决定发送内容，Clawbot 负责投递

---

## API 设计

### 发送消息

```http
POST /api/webhooks/:accountId
Authorization: Bearer <webhook_token>
Content-Type: application/json

{
  "conversationId": "wxid_xxx",  // 可选，不填则发给文件传输助手
  "text": "消息内容"
}
```

**参数说明：**
- `accountId`: 目标微信账号 ID（从账号列表获取）
- `webhook_token`: 业务系统的认证令牌
- `conversationId`: 必填，指定会话 ID；发送到文件传输助手时传 `"filehelper"`
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
| 400 | `invalid_params` | 参数校验失败（text 为空、超长、缺少 conversationId 等） |
| 401 | `invalid_token` | Token 无效或已禁用 |
| 404 | `account_not_found` | accountId 不存在 |
| 429 | `rate_limited` | 超出频率限制，响应包含 `Retry-After` header |
| 503 | `account_offline` | 目标账号未登录/离线，无法投递 |

```json
{
  "error": "account_offline",
  "message": "目标账号当前离线，无法投递消息",
  "code": 503
}
```

> **投递模式说明：** 消息投递为同步模式 —— API 调用会等待微信侧发送完成后返回。
> 如果微信发送失败，响应中会携带错误信息，业务系统可根据 `Idempotency-Key` 安全重试。

---

## 数据库设计

### webhook_tokens 表

> Token 安全策略：数据库仅存储 token 的 SHA-256 哈希值，明文 token 仅在创建时返回一次。
> Token 生成规范：使用 `crypto.randomBytes(32)` 生成，添加 `whk_` 前缀便于识别和日志脱敏。

```sql
CREATE TABLE webhook_tokens (
  account_id TEXT NOT NULL,
  source TEXT NOT NULL,        -- 业务系统标识，如 'order-system'
  token_hash TEXT NOT NULL,    -- token 的 SHA-256 哈希值（不存储明文）
  token_prefix TEXT NOT NULL,  -- token 前 8 位，用于管理界面展示（如 'whk_a3f2...'）
  description TEXT,            -- 业务系统描述
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, source),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_tokens_hash ON webhook_tokens(token_hash);
```

> **Prisma 对齐提醒：** 实际实现需在 `schema.prisma` 中定义对应模型，通过 Prisma Migration 管理表结构。

### webhook_logs 表

> 投递日志为生产必备能力，业务系统排查问题时强依赖，已提升至 Phase 1。

```sql
CREATE TABLE webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  source TEXT NOT NULL,
  conversation_id TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL,         -- 'success', 'failed', 'rejected'
  error TEXT,
  idempotency_key TEXT,         -- 调用方传入的幂等键
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_logs_account ON webhook_logs(account_id, created_at DESC);
CREATE INDEX idx_webhook_logs_idempotency ON webhook_logs(idempotency_key) WHERE idempotency_key IS NOT NULL;
```

---

## 使用示例

### 1. 订单系统推送

```bash
curl -X POST https://your-domain/api/webhooks/a4a211b304be-im-bot \
  -H "Authorization: Bearer order_system_token_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "新订单通知\n订单号：#12345\n金额：¥999\n客户：张三"
  }'
```

### 2. 告警系统推送

```bash
curl -X POST https://your-domain/api/webhooks/a4a211b304be-im-bot \
  -H "Authorization: Bearer alert_system_token_xyz789" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "🚨 告警通知\n服务器：web-01\nCPU 使用率：95%\n时间：2026-03-27 10:30"
  }'
```

### 3. 发送到指定会话

```bash
curl -X POST https://your-domain/api/webhooks/a4a211b304be-im-bot \
  -H "Authorization: Bearer crm_system_token_def456" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "wxid_customer_001",
    "text": "您好，您的工单已处理完成"
  }'
```

---

## 管理接口

### 创建 Webhook Token

```http
POST /api/accounts/:accountId/webhooks
Authorization: Bearer <api_secret>

{
  "source": "order-system",
  "description": "订单系统 Webhook"
}
```

**响应：**
```json
{
  "token": "whk_abc123xyz789...",
  "source": "order-system",
  "accountId": "a4a211b304be-im-bot",
  "enabled": true,
  "createdAt": "2026-03-27T10:00:00Z"
}
```

> ⚠️ `token` 明文仅在此响应中返回一次，后续无法再次获取。请妥善保存。

### 列出 Webhook Tokens

```http
GET /api/accounts/:accountId/webhooks
Authorization: Bearer <api_secret>
```

**响应：**
```json
{
  "data": [
    {
      "source": "order-system",
      "enabled": true,
      "createdAt": "2026-03-27T10:00:00Z",
      "lastUsedAt": "2026-03-27T10:30:00Z"
    }
  ]
}
```

### 禁用/启用 Token

```http
PATCH /api/accounts/:accountId/webhooks/:source
Authorization: Bearer <api_secret>

{
  "enabled": false
}
```

### 轮换 Token

生成新 token 替换旧 token，旧 token 立即失效：

```http
POST /api/accounts/:accountId/webhooks/:source/rotate
Authorization: Bearer <api_secret>
```

**响应：**
```json
{
  "token": "whk_new_token...",
  "source": "order-system",
  "accountId": "a4a211b304be-im-bot",
  "rotatedAt": "2026-03-27T12:00:00Z"
}
```

### 删除 Token

```http
DELETE /api/accounts/:accountId/webhooks/:source
Authorization: Bearer <api_secret>
```

### 查询调用日志

业务系统可查询自己的投递历史：

```http
GET /api/accounts/:accountId/webhooks/:source/logs?limit=20
Authorization: Bearer <api_secret>
```

**响应：**
```json
{
  "data": [
    {
      "conversationId": "wxid_xxx",
      "status": "success",
      "createdAt": "2026-03-27T10:30:00Z"
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
   - 频率限制：默认 60 次/分钟/Token，使用滑动窗口算法
   - 超限返回 `429 Too Many Requests` + `Retry-After` header
   - 记录异常调用行为
   - 支持 IP 白名单（可选）

3. **消息验证**
   - 限制消息长度：4000 字符
   - `Idempotency-Key` 防重复投递（24 小时内同 key 返回缓存结果）
   - 账号离线检查：投递前校验目标账号在线状态（90 秒心跳阈值）
   - 防止消息轰炸

4. **认证隔离**
   - 管理接口使用 `API_SECRET` 认证（与现有 API 一致）
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
- ⬜ 基础 Webhook 接口（路由占位，待 SDK 支持主动发送后接入）
- ⬜ Token 认证（SHA-256 哈希存储）
- ⬜ 发送文本消息
- ⬜ 完整错误响应（400/401/404/429/503）
- ⬜ 账号在线状态校验
- ⬜ Webhook 投递日志
- ⬜ Prisma 模型定义 + Migration

**Phase 2：**
- ⬜ Token 管理接口（CRUD + 轮换）
- ⬜ 调用日志查询接口
- ⬜ 频率限制（滑动窗口，60次/分钟）
- ⬜ 幂等性支持（Idempotency-Key）

**Phase 3：**
- ⬜ 消息模板
- ⬜ 批量发送
- ⬜ 富文本消息
