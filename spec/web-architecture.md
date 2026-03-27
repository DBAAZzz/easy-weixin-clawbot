# Web 端架构方案（v3 — 可实施版）

## Context

当前项目是一个微信 bot monorepo（server + shared），所有会话存储在内存中，无 HTTP 层。需要新增 web 端来展示聊天记录、登录二维码和后续 skill 配置。技术栈：React + Vite + shadcn/ui + Hono + Supabase。

### 关键修订记录

| 问题 | v1 设计 | v3 修订 |
| ---- | ------- | ------- |
| 消息模型有损 | `content TEXT` + 3 种 role | `payload JSONB` 存完整 pi-ai `Message`，`content_text` 为可搜索提取列 |
| 一致性模型不闭环 | 内存权威 + DB fire-and-forget，无补偿 | 内存权威不变，DB 写入加重试队列 + 启动时可选恢复 |
| 登录二维码无数据源 | 假设 SDK 能返回 base64 | 实测确认：SDK 向 stdout 打印终端字符画，拦截 stdout 捕获原始文本，前端 `<pre>` 等宽渲染 |
| 安全边界为零 | 前端直连 Supabase + 无 RLS | 前端只走 Hono API，不暴露 Supabase 凭证 |
| 派生字段无维护机制 | `is_online` / `message_count` 等无更新逻辑 | Supabase trigger 自动维护 + server heartbeat |
| 分页/去重缺失 | cursor 语义未定义，无去重约束 | cursor 基于 `id`（单调递增），消息表加 `(account_id, conversation_id, seq)` 唯一约束 |
| 实时方案过重 | SSE + Supabase Realtime 订阅 | 不做实时，前端页面刷新拉取最新数据 |
| seq 分配未定义 | 伪代码传入 seq 但未说明来源 | seq = `history.length`，单会话串行保证单调，无需分布式锁 |
| 首条消息丢统计 | trigger 只 UPDATE 已有 conversation | trigger 改为 INSERT ON CONFLICT DO UPDATE（upsert） |
| 图片 base64 膨胀 | payload 原样存储含 base64 | 写入前剥离 `ImageContent.data`，存文件路径引用 |
| is_online 脏状态 | 依赖 graceful shutdown 置 false | 去掉物理列，改为 `last_seen_at` 派生判断（90s 阈值） |
| 鉴权定位模糊 | 静态 Bearer token 表述为"鉴权" | 明确为"门栏"非安全边界，标注公网部署需 HTTPS + IP 白名单 |

---

## 1. 包结构

```text
packages/
  shared/        -- 共享类型（API 类型、DB Row 类型）
  server/        -- 现有 bot + Hono API + Supabase 持久化
  web/           -- 新建：React + Vite + shadcn/ui
```

### server 新增模块

```text
packages/server/src/
  db/
    prisma.ts           -- Prisma client 单例（连接 Supabase Postgres）
    messages.ts         -- 消息读写（payload JSONB）
    accounts.ts         -- 账号读写 + heartbeat
    conversations.ts    -- 会话读写
  api/
    index.ts            -- Hono app，挂载路由，CORS，Bearer token 校验
    routes/
      accounts.ts       -- /api/accounts
      conversations.ts  -- /api/conversations
      messages.ts       -- /api/messages
      login.ts          -- /api/login（二维码 + 状态轮询）
      health.ts         -- /api/health
  login/
    qr-capture.ts       -- 拦截 stdout 捕获 SDK 二维码字符画
    login-manager.ts    -- 登录状态机（idle → qr_ready → scanning → done/expired）
```

### web 结构

```text
packages/web/src/
  pages/           -- DashboardPage, ConversationPage, LoginPage
  components/      -- AccountCard, ConversationList, MessageList, MessageBubble, QrCodeDisplay
  components/ui/   -- shadcn/ui 组件
  components/layout/ -- AppShell, Sidebar
  hooks/           -- useAccounts, useConversations, useMessages
  lib/             -- api.ts (fetch 封装，Bearer token)
```

---

## 2. Supabase 数据库设计

```sql
-- 账号表
-- 注意：不存 is_online 物理列，在线状态由 last_seen_at 派生判断
CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  display_name  TEXT,
  last_seen_at  TIMESTAMPTZ,               -- server 每 60s 更新，异常退出也不会留脏状态
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 会话表
CREATE TABLE conversations (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  title           TEXT,
  last_message_at TIMESTAMPTZ,
  message_count   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (account_id, conversation_id)
);

CREATE INDEX idx_conversations_account ON conversations(account_id);

-- 消息表：存完整 pi-ai Message 结构
CREATE TABLE messages (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  seq             INTEGER NOT NULL,               -- 该会话内的消息序号，从 1 开始
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'toolResult')),
  content_text    TEXT,                            -- 提取的纯文本（用于搜索和 web 展示）
  payload         JSONB NOT NULL,                  -- 完整 pi-ai Message 对象（用于恢复 LLM 上下文）
  media_type      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (account_id, conversation_id, seq)       -- 去重约束
);

CREATE INDEX idx_messages_lookup ON messages(account_id, conversation_id, id);

-- 消息插入时自动 upsert conversation + 更新统计
-- 解决：首条消息时 conversation 行不存在的问题
CREATE OR REPLACE FUNCTION upsert_conversation_on_message()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO conversations (account_id, conversation_id, last_message_at, message_count)
  VALUES (NEW.account_id, NEW.conversation_id, NEW.created_at, 1)
  ON CONFLICT (account_id, conversation_id)
  DO UPDATE SET
    last_message_at = NEW.created_at,
    message_count = conversations.message_count + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_message_insert
AFTER INSERT ON messages
FOR EACH ROW EXECUTE FUNCTION upsert_conversation_on_message();
```

- 不启用 Supabase Realtime（前端不需要实时推送）
- 不启用 RLS（单用户自托管），anon key 不暴露给前端

---

## 3. 消息存储模型

### 写入

`ai.ts` 在每轮对话中产生的 pi-ai `Message` 对象，序列化为 JSON 存入 `payload` 字段。同时提取纯文本存入 `content_text` 供搜索和 web 展示。

**图片 base64 剥离**：`ai.ts` 当前会把图片 `readFileSync().toString("base64")` 直接塞进 `ImageContent.data`。如果原样存入 JSONB，一张 3MB 图片 base64 后约 4MB，数据库会快速膨胀。写入 payload 前，需要把 `ImageContent.data` 替换为文件路径引用，仅在恢复上下文时按需重新读取。

**seq 分配**：`ai.ts` 的 `chat()` 对同一会话是 `await` 串行的（`while(true)` 循环内逐轮调用 `complete()`），不存在并发写入。seq 直接取内存 `history.length`（push 之后的索引），保证单调递增。

```typescript
// 伪代码：写入一条消息
async function persistMessage(accountId: string, conversationId: string, msg: Message, seq: number) {
  const contentText = extractText(msg);
  const payload = stripBase64FromPayload(msg);  // 图片 content 的 data 替换为 filePath 引用
  await supabase.from('messages').insert({
    account_id: accountId,
    conversation_id: conversationId,
    seq,                                         // = history.length，串行保证单调递增
    role: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'toolResult',
    content_text: contentText,
    payload,
    media_type: extractMediaType(msg),
  });
}

// 剥离 base64，避免 JSONB 膨胀
function stripBase64FromPayload(msg: Message): Record<string, unknown> {
  const clone = structuredClone(msg) as any;
  if (Array.isArray(clone.content)) {
    for (const block of clone.content) {
      if (block.type === 'image' && block.data) {
        // 保留 mimeType，用 filePath 标记来源，删除 base64 数据
        block.data = undefined;
        block.stripped = true;  // 标记已剥离，恢复时需重新读取
      }
    }
  }
  return clone;
}
```

### 恢复上下文

进程重启时，可从 Supabase 恢复 LLM 上下文：

```typescript
async function restoreHistory(accountId: string, conversationId: string): Promise<Message[]> {
  const { data } = await supabase
    .from('messages')
    .select('payload')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: true });
  return (data ?? []).map(row => row.payload as Message);
}
```

这保证了**无损恢复**：存进去什么 pi-ai `Message`，拿出来就是什么。

---

## 4. 登录二维码方案

### SDK 实际行为（已验证）

`weixin-agent-sdk` 的 `login()` 函数：

- `log` 回调接收文字提示（"正在启动微信扫码登录..."、"等待扫码..."）
- **QR 码直接打到 `process.stdout`**，使用 Unicode block 字符（`█▄▀` 等），不走 log 回调
- 返回 `Promise<string>`（account ID），登录成功后 resolve

### 捕获方案：拦截 `process.stdout.write`，原样存储

不做任何解析或转换。拦截 stdout 输出，检测含 QR block 字符的文本块，原样保存为字符串。前端用 `<pre>` 等宽字体直接渲染。

```text
login-manager.ts 调用 login()
  -> qr-capture.ts: monkey-patch process.stdout.write
    -> 检测含 block 字符（█▄▀）的输出块
    -> 缓冲完整 QR 码文本
    -> 存入 login-manager 状态（原始字符串）
    -> 恢复原始 stdout.write
```

#### qr-capture.ts 核心逻辑

```typescript
const QR_CHARS = /[█▄▀▐▌░▒▓]/;

function captureStdout(onQrBlock: (raw: string) => void): () => void {
  const original = process.stdout.write.bind(process.stdout);
  let buffer = '';
  let capturing = false;

  process.stdout.write = ((chunk: any, ...args: any[]) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();

    if (QR_CHARS.test(str)) {
      capturing = true;
      buffer += str;
      // 同时打到终端，方便调试
      return original(chunk, ...args);
    }

    if (capturing && str.trim() === '') {
      // QR 码结束（空行分隔）
      onQrBlock(buffer);
      buffer = '';
      capturing = false;
    }

    return original(chunk, ...args);
  }) as any;

  return () => { process.stdout.write = original; };
}
```

### 登录状态机

```typescript
type LoginState =
  | { status: 'idle' }
  | { status: 'qr_ready'; qr_text: string }       // 原始终端字符画
  | { status: 'scanning' }
  | { status: 'done'; account_id: string }
  | { status: 'expired' }
  | { status: 'error'; message: string };
```

### 前端渲染

```tsx
// QrCodeDisplay 组件
function QrCodeDisplay({ qrText }: { qrText: string }) {
  return (
    <pre style={{
      fontFamily: 'monospace',
      fontSize: '8px',
      lineHeight: '8px',
      letterSpacing: '0',
      background: '#fff',
      color: '#000',
      padding: '16px',
      display: 'inline-block',
    }}>
      {qrText}
    </pre>
  );
}
```

### API

| Method | Path | 说明 |
| ------ | ---- | ---- |
| POST | `/api/login/start` | 触发 `login()`，异步启动登录流程 |
| GET | `/api/login/status` | 返回当前 `LoginState`（含 `qr_text`） |
| POST | `/api/login/cancel` | 取消进行中的登录 |

前端轮询 `/api/login/status`（每 2s），根据状态展示二维码或提示信息。

---

## 5. API 设计（Hono）

### 鉴权

单用户自托管场景，使用静态 Bearer token（从 `API_SECRET` 环境变量读取）。

**明确定位**：这不是安全边界，是"别随便连"的门栏。部署在公网时，必须配合 HTTPS + 反向代理 IP 白名单。未来如需多用户，升级路径为 Supabase Auth + JWT。

```typescript
const auth = (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token !== process.env.API_SECRET) return c.json({ error: 'unauthorized' }, 401);
  return next();
};
```

前端通过 Vite 环境变量 `VITE_API_SECRET` 注入。**注意**：该值会编译进前端产物，任何能访问 web 页面的人都能从 JS bundle 中提取。自托管局域网场景可接受；公网部署时必须配合网络层限制。

### 路由

| Method | Path | 说明 |
| ------ | ---- | ---- |
| GET | `/api/health` | 服务状态、uptime |
| GET | `/api/accounts` | 账号列表 + 在线状态 |
| GET | `/api/accounts/:accountId` | 单个账号详情 |
| GET | `/api/accounts/:accountId/conversations` | 会话列表，按 `last_message_at` 降序 |
| GET | `/api/accounts/:accountId/conversations/:conversationId/messages` | 分页消息，`limit=50`，`before=<id>` |
| POST | `/api/login/start` | 触发登录流程 |
| GET | `/api/login/status` | 轮询登录状态（含 QR 字符画） |
| POST | `/api/login/cancel` | 取消登录 |

### 分页

- cursor 基于 `messages.id`（`BIGINT GENERATED ALWAYS AS IDENTITY`，单调递增）
- `before=<id>` 表示返回 `id < before` 的消息，按 `id DESC` 排列，取 `limit` 条
- 响应中 `next_cursor` = 返回结果中最小的 `id`，无更多数据时省略

### 响应格式

```typescript
// 成功
{ data: T }

// 分页
{ data: T[], has_more: boolean, next_cursor?: number }

// 错误
{ error: string }
```

Hono 中间件：`cors({ origin })` + `logger()` + auth + 统一错误处理。

---

## 6. 前端页面

| 路由 | 页面 | 说明 |
| ---- | ---- | ---- |
| `/` | DashboardPage | 账号卡片列表，显示在线状态、会话数量，点击进入会话 |
| `/accounts/:accountId` | ConversationPage | 左侧会话列表 + 右侧消息流（分栏布局） |
| `/login` | LoginPage | 触发登录 → 轮询展示 QR 字符画 → 扫码成功后跳转 `/` |

### 组件树

```text
<AppShell>
  <Sidebar>
    - 账号导航链接
    - 登录入口
  </Sidebar>
  <main>
    <Outlet />
  </main>
</AppShell>
```

### 关键组件

- `AccountCard` — shadcn Card，账号摘要 + 在线状态圆点（绿/红）
- `ConversationList` — ScrollArea + 搜索过滤
- `MessageList` — 可滚动消息区域，向上滚动加载更多（分页）
- `MessageBubble` — 用户消息右对齐（蓝色），助手左对齐（灰色），toolResult 等宽字体
- `QrCodeDisplay` — `<pre>` 等宽渲染终端二维码字符画

### 数据获取策略

前端不做实时订阅。所有数据通过 REST API 在页面加载时获取：

- 进入 DashboardPage → `GET /api/accounts`
- 进入 ConversationPage → `GET /api/accounts/:id/conversations` + `GET .../messages`
- 进入 LoginPage → `POST /api/login/start` + 轮询 `GET /api/login/status`（每 2s）
- 刷新页面即可获取最新数据

---

## 7. 数据流

### 写入路径（bot 收到微信消息）

```text
weixin-agent-sdk 回调
  -> agent.chat()
    -> ai.ts 处理消息
      -> 内存 Map push（保留，供 LLM 上下文）
      -> 异步写入 Supabase messages 表（带重试队列，失败不阻塞 bot）
      -> conversations 派生字段由 DB trigger 自动维护
```

### 读取路径（web 加载会话）

```text
前端页面加载 / 刷新
  -> GET /api/.../messages（拉取历史，基于 id 分页）
  -> Hono 从 Supabase 查询返回
```

### 账号在线状态（派生判断）

不使用 `is_online` 物理列。在线状态由 `last_seen_at` 派生：**`now() - last_seen_at < 90s` 即为在线**（heartbeat 间隔 60s，留 30s 余量）。异常退出（kill -9、OOM）不会留下脏状态，最多 90s 后自动判定离线。

```text
server 启动
  -> upsert accounts 表
  -> 每 60s heartbeat 更新 last_seen_at = now()
  -> 进程退出时（graceful shutdown）last_seen_at 设为远过去值（立即离线）

API 返回账号列表时：
  -> SELECT *, (now() - last_seen_at < interval '90 seconds') AS is_online FROM accounts
```

### 设计原则

- 内存 Map 是 LLM 上下文的权威来源（不变）
- Supabase 是持久化层，写入带重试（最终一致），不阻塞 bot
- `payload JSONB` 可无损恢复 LLM 上下文，`content_text` 供搜索和展示
- 前端只与 Hono API 交互，不持有 Supabase 凭证
- 不做实时推送，前端刷新获取最新数据（MVP 够用）

---

## 8. 开发工作流

### 启动方式

- Server: `tsx watch src/index.ts`（端口 3001，bot + Hono API）
- Web: `vite dev`（端口 5173，proxy `/api` → 3001）

### Vite 代理配置

```ts
// packages/web/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
```

### 根 package.json scripts

```json
{
  "dev": "pnpm -F server dev & pnpm -F web dev",
  "dev:server": "pnpm -F server dev",
  "dev:web": "pnpm -F web dev",
  "build": "pnpm -F shared build && pnpm -F server build && pnpm -F web build"
}
```

### 环境变量

- `packages/server/.env`: `SUPABASE_PASSWORD` 或 `DATABASE_URL`/`DIRECT_URL`，以及 `API_PORT=3001`, `API_SECRET`
- `packages/web/.env`: `VITE_API_SECRET`（自托管场景，前端注入 Bearer token）

---

## 9. 共享类型（packages/shared 新增）

```typescript
/** 数据库行类型 */
export interface AccountRow {
  id: string;
  display_name: string | null;
  last_seen_at: string | null;
  created_at: string;
  is_online: boolean;              // 派生字段，API 层计算：now() - last_seen_at < 90s
}

export interface ConversationRow {
  id: number;
  account_id: string;
  conversation_id: string;
  title: string | null;
  last_message_at: string | null;
  message_count: number;
  created_at: string;
}

export interface MessageRow {
  id: number;
  account_id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant' | 'toolResult';
  content_text: string | null;
  payload: Record<string, unknown>;   // pi-ai Message，前端展示用 content_text，恢复上下文用 payload
  media_type: string | null;
  created_at: string;
}

/** API 响应 */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  has_more: boolean;
  next_cursor?: number;              // messages.id，单调递增
}

/** 登录状态 */
export type LoginState =
  | { status: 'idle' }
  | { status: 'qr_ready'; qr_text: string }   // 原始终端字符画文本
  | { status: 'scanning' }
  | { status: 'done'; account_id: string }
  | { status: 'expired' }
  | { status: 'error'; message: string };
```

---

## 10. 新增依赖

### packages/server

- `hono` — HTTP 框架
- `@hono/node-server` — Node.js 适配器
- `@prisma/client` — Prisma 运行时客户端
- `prisma` — schema / generate / db push CLI

### packages/web（新建）

- `react`, `react-dom`
- `react-router-dom`
- `tailwindcss`, `@tailwindcss/vite`
- shadcn/ui（通过 `npx shadcn@latest init` 安装）
- `@clawbot/shared`（workspace 依赖）

---

## 11. 实施顺序

### Phase 1: 数据库 + 持久化

1. Supabase 建表（上述 SQL，含 trigger）
2. server 安装 `@prisma/client` + `prisma`，创建 `db/` 模块
3. 改造 `ai.ts`：每轮消息写入 Supabase（payload JSONB + content_text + seq）
4. 改造 `conversation.ts`：启动时可选从 Supabase 恢复上下文（`restoreHistory`）
5. 改造 `index.ts`：启动时 upsert 账号 + heartbeat 定时器
6. 扩展 shared 类型

### Phase 2: Hono API

1. server 安装 `hono` + `@hono/node-server`
2. 创建 `api/` 路由模块（含 Bearer token 校验）
3. `index.ts` 启动 Hono 服务（与 bot 并行运行）

### Phase 3: 登录二维码

1. 实现 `login/qr-capture.ts`（拦截 stdout，缓冲原始字符画）
2. 实现 `login/login-manager.ts`（状态机）
3. 挂载 `/api/login/*` 路由

### Phase 4: 前端

1. Vite 脚手架创建 `packages/web`
2. 安装 Tailwind + shadcn/ui
3. 搭建 layout + 路由
4. 实现 DashboardPage → ConversationPage → LoginPage
5. `QrCodeDisplay` 用 `<pre>` 渲染二维码字符画

---

## 12. 验证方式

1. 启动 server，确认 Hono 在 3001 端口响应 `GET /api/health`（需 Bearer token）
2. 发送微信消息，确认 Supabase messages 表有新数据，payload 为完整 pi-ai Message
3. 确认 conversations 表的 `last_message_at` 和 `message_count` 由 trigger 自动更新
4. 重启 server，确认 `restoreHistory` 能无损恢复 LLM 上下文
5. 触发 `/api/login/start`，轮询 `/api/login/status`，确认返回 QR 字符画文本
6. 启动 web，确认 DashboardPage 显示账号列表
7. 点进账号，确认聊天记录正确加载
8. LoginPage 确认 `<pre>` 渲染的二维码可用微信扫描
9. 确认无 Bearer token 的请求被 401 拒绝

---

## 关键修改文件

| 文件 | 改动 |
| ---- | ---- |
| `packages/server/src/ai.ts` | 每轮消息写入 Supabase（payload JSONB） |
| `packages/server/src/conversation.ts` | 启动时从 Supabase 恢复上下文 |
| `packages/server/src/index.ts` | 启动 Hono + upsert 账号 + heartbeat |
| `packages/server/src/login/` | 新增：stdout 拦截 + 登录状态机 |
| `packages/server/src/api/` | 新增：Hono 路由 |
| `packages/server/src/db/` | 新增：Supabase 数据访问层 |
| `packages/shared/src/types.ts` | 新增共享类型 |
| `packages/server/package.json` | 新增依赖 |
| `package.json` | 更新根 scripts |
