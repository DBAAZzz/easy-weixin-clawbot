# Web API 拆分迁移文档（按页面/路由域）

## 1. 背景

当前 [`packages/web/src/lib/api.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/lib/api.ts) 同时承载了：

- 请求基础设施（`request` / `requestPaginated` / `toQueryString`）
- 所有页面域接口（auth、mcp、tools、skills、webhooks、scheduled-tasks、model-config、observability…）
- 页面私有类型（`WebhookTokenInfo`、`ScheduledTaskDto` 等）

导致问题：

- 单文件持续膨胀，冲突概率高。
- 页面边界不清晰，找接口成本高。
- 后续按页面迭代时难以局部维护。

目标：迁移到 `api` 目录并按页面（路由域）拆分。

## 2. 迁移目标

- 保持运行行为不变（纯重构）。
- API 文件按页面域拆分，`api.ts` 最终删除或仅保留过渡 re-export。
- 每个页面只依赖对应域 API。
- 请求底座统一在 `api/core`。

## 3. 目标目录结构

建议落地到 `packages/web/src/api/`：

```txt
api/
  core/
    auth.ts              # getAuthToken / 401处理
    client.ts            # request / requestPaginated / rawRequest
    query.ts             # toQueryString
  health.ts
  accounts.ts            # Dashboard/AccountCard/通用账户列表
  conversation.ts        # ConversationPage + Message hooks
  memory-graph.ts        # MemoryGraphPage 相关
  observability.ts
  auth-login.ts          # /auth/login 页面
  wechat-login.ts        # /login 页面（扫码登录）
  tools.ts
  skills.ts
  mcp.ts
  webhooks.ts
  scheduled-tasks.ts
  model-config.ts
  index.ts               # 统一导出（可选）
```

说明：

- “按页面”在实现上按“路由域”聚合，避免每个页面一个零碎文件。
- `accounts.ts`、`conversation.ts` 被多个页面复用是允许的，仍属于页面域抽象。

## 4. 旧接口到新文件映射

### 4.1 基础层（先迁）

- `getAuthToken` -> `api/core/auth.ts`
- `request` -> `api/core/client.ts`
- `requestPaginated` -> `api/core/client.ts`
- `webhookRequest` -> 合并进 `api/core/client.ts` 的 `rawRequest`（支持非 `{data}` 包裹）
- `toQueryString` -> `api/core/query.ts`

### 4.2 页面域接口映射

- `health.ts`
- `fetchHealth`

- `accounts.ts`
- `fetchAccounts`
- `updateAccountAlias`
- `fetchConversations`（若你希望会话单独域，可放 `conversation.ts`）

- `conversation.ts`
- `fetchMessages`

- `memory-graph.ts`
- `fetchTapeGraph`

- `observability.ts`
- `fetchObservabilityOverview`
- `fetchObservabilityTraces`
- `fetchObservabilityTrace`

- `auth-login.ts`
- `login`

- `wechat-login.ts`
- `startLogin`
- `fetchLoginStatus`
- `cancelLogin`

- `tools.ts`
- `fetchTools`
- `fetchToolSource`
- `installTool`
- `updateTool`
- `enableTool`
- `disableTool`
- `removeTool`

- `skills.ts`
- `fetchSkills`
- `fetchSkillSource`
- `installSkill`
- `updateSkill`
- `enableSkill`
- `disableSkill`
- `removeSkill`

- `mcp.ts`
- `fetchMcpServers`
- `createMcpServer`
- `updateMcpServer`
- `refreshMcpServer`
- `enableMcpServer`
- `disableMcpServer`
- `deleteMcpServer`
- `fetchMcpTools`
- `enableMcpTool`
- `disableMcpTool`

- `webhooks.ts`
- `WebhookTokenInfo`（type/interface）
- `WebhookLogEntry`（type/interface）
- `WebhookMessageType`（type）
- `WebhookTestRequest`（type）
- `fetchWebhookTokens`
- `createWebhookToken`
- `toggleWebhookToken`
- `rotateWebhookToken`
- `deleteWebhookToken`
- `fetchWebhookLogs`
- `testWebhookToken`

- `scheduled-tasks.ts`
- `ScheduledTaskDto`（type/interface）
- `ScheduledTaskRunDto`（type/interface）
- `fetchScheduledTasks`
- `fetchScheduledTask`
- `toggleScheduledTask`
- `fetchScheduledTaskRuns`

- `model-config.ts`
- `fetchModelConfigs`
- `fetchModelProviderTemplates`
- `createModelProviderTemplate`
- `updateModelProviderTemplate`
- `deleteModelProviderTemplate`
- `pingModelProviderTemplate`
- `upsertModelConfig`
- `deleteModelConfig`

### 4.3 低优先级未使用接口（可后续处理）

当前仅在 `api.ts` 内定义、业务代码未引用：

- `fetchCapabilities`
- `fetchLegacySkills`
- `fetchScheduledTask`

处理建议：

- 如果后续页面会用，迁移到对应域文件。
- 如果确认废弃，迁移完成后删除并在 PR 说明里标注。

## 5. 消费方迁移清单（按页面/Hook）

以下文件需要把 `../lib/api.js` 改为新路径：

- [`packages/web/src/pages/AuthLoginPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/AuthLoginPage.tsx)
- [`packages/web/src/pages/LoginPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/LoginPage.tsx)
- [`packages/web/src/pages/ToolsPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/ToolsPage.tsx)
- [`packages/web/src/pages/SkillsPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/SkillsPage.tsx)
- [`packages/web/src/pages/McpPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/McpPage.tsx)
- [`packages/web/src/pages/WebhooksPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/WebhooksPage.tsx)
- [`packages/web/src/pages/WebhookLogsPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/WebhookLogsPage.tsx)
- [`packages/web/src/pages/ScheduledTasksPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/ScheduledTasksPage.tsx)
- [`packages/web/src/pages/ModelConfigPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/ModelConfigPage.tsx)
- [`packages/web/src/pages/ProviderConfigPage.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/pages/ProviderConfigPage.tsx)
- [`packages/web/src/components/AccountCard.tsx`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/components/AccountCard.tsx)
- [`packages/web/src/hooks/useAccounts.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useAccounts.ts)
- [`packages/web/src/hooks/useConversations.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useConversations.ts)
- [`packages/web/src/hooks/useMessages.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useMessages.ts)
- [`packages/web/src/hooks/useObservability.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useObservability.ts)
- [`packages/web/src/hooks/useMcp.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useMcp.ts)
- [`packages/web/src/hooks/useTools.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useTools.ts)
- [`packages/web/src/hooks/useSkills.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useSkills.ts)
- [`packages/web/src/hooks/useTapeGraph.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useTapeGraph.ts)
- [`packages/web/src/hooks/useHealth.ts`](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/web/src/hooks/useHealth.ts)

## 6. 推荐执行顺序（给其他 AI）

### Phase 0：准备与兜底

- 新建 `src/lib/api/core/*`。
- 暂时保留原 `api.ts`，避免一步到位导致大量红线。

### Phase 1：创建分模块 API 文件

- 按第 3 节建立目录与空文件。
- 把 `api.ts` 内实现按映射搬迁。
- 各模块仅 import 自己需要的 shared types，避免继续集中依赖。

### Phase 2：建立过渡导出层

- 在 `src/lib/api/index.ts` 做统一导出（可选）。
- 让旧 `src/lib/api.ts` 先改为仅 `export * from "./api/index.js";`（过渡期兼容）。

### Phase 3：迁移调用方 import

- 逐文件把 `../lib/api.js` 改成对应模块路径，例如：
- `../lib/api/tools.js`
- `../lib/api/webhooks.js`
- `../lib/api/model-config.js`

### Phase 4：清理与收口

- 确认全仓不再直接引用旧 `api.ts` 后删除它，或将其保留为 1 行转发并加弃用注释。
- 删除未使用接口或补齐对应消费方。

## 7. 每阶段验收标准

- TypeScript 通过：`npm run build`（在 `packages/web` 下）
- 格式通过：`npm run fmt:check`（在 `packages/web` 下）
- 搜索确认无旧引用：`rg \"../lib/api\\.js\" packages/web/src`
- 功能冒烟：
- 登录页（`/auth/login`、`/login`）
- Tools / Skills / MCP
- Webhooks / Webhook Logs
- Scheduled Tasks
- Model Config / Provider Config
- Observability

## 8. 风险与规避

- 风险：循环依赖（模块间互相 import）
- 规避：所有网络请求能力只从 `api/core/*` 向上单向依赖。

- 风险：同名类型分散导致导入混乱
- 规避：每个域类型与函数共置在同文件，必要时在 `api/index.ts` 做 type re-export。

- 风险：Webhooks 返回结构与通用 `request` 约定不一致
- 规避：保留 `rawRequest`，仅 webhooks 域使用。

- 风险：批量改 import 容易漏改
- 规避：每迁完一域就执行一次 `rg` + `build`。

## 9. 可直接给其他 AI 的执行指令

```txt
请在 packages/web 执行 API 拆分重构：
1) 将 src/lib/api.ts 拆分到 src/lib/api/ 目录，按路由域分文件（见文档 docs/web-api-migration-by-page.md）。
2) 提取请求底座到 src/lib/api/core/client.ts 与 core/query.ts。
3) 保持行为不变，不改接口签名，不改 query key，不改页面逻辑。
4) 分阶段迁移 imports，确保每阶段都能通过 npm run build 和 npm run fmt:check。
5) 最后输出：变更文件列表、未迁移项、风险点。
```

