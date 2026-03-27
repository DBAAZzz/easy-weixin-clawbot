# Webhook 集成方案

## 概述

业务系统通过 Webhook 接口向指定微信账号推送消息，实现外部系统与微信的集成。

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
- `conversationId`: 可选，指定会话 ID；不填则发送到文件传输助手
- `text`: 消息文本内容

**响应：**
```json
{
  "success": true,
  "messageId": "msg_xxx"
}
```

**错误响应：**
```json
{
  "error": "invalid token",
  "code": 401
}
```

---

## 数据库设计

### webhook_tokens 表

```sql
CREATE TABLE webhook_tokens (
  account_id TEXT NOT NULL,
  source TEXT NOT NULL,        -- 业务系统标识，如 'order-system'
  token TEXT NOT NULL,          -- webhook 认证令牌
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, source),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_webhook_tokens_token ON webhook_tokens(token);
```

### webhook_logs 表（可选）

```sql
CREATE TABLE webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  source TEXT NOT NULL,
  conversation_id TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL,         -- 'success', 'failed'
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_webhook_logs_account ON webhook_logs(account_id, created_at DESC);
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
  "token": "wh_abc123xyz789...",
  "source": "order-system",
  "accountId": "a4a211b304be-im-bot"
}
```

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

### 删除 Token

```http
DELETE /api/accounts/:accountId/webhooks/:source
Authorization: Bearer <api_secret>
```

---

## 安全建议

1. **Token 管理**
   - Token 应使用加密存储
   - 定期轮换 Token
   - 记录 Token 使用日志

2. **访问控制**
   - 限制每个 Token 的调用频率
   - 记录异常调用行为
   - 支持 IP 白名单（可选）

3. **消息验证**
   - 限制消息长度（如 4000 字符）
   - 过滤敏感内容
   - 防止消息轰炸

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
- ✅ 基础 Webhook 接口
- ✅ Token 认证
- ✅ 发送文本消息

**Phase 2：**
- ⬜ Token 管理接口
- ⬜ Webhook 日志
- ⬜ 频率限制

**Phase 3：**
- ⬜ 消息模板
- ⬜ 批量发送
- ⬜ 富文本消息
