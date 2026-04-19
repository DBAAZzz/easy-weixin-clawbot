# AGENTS.md — @clawbot/web

> React 19 SPA 管理后台，Vite 8 + Tailwind CSS 4 + shadcn/ui。

## 目录结构

```
src/
├── main.tsx              # React DOM 挂载
├── app.tsx               # QueryClientProvider 根组件
├── styles.css            # Tailwind 4 @theme 设计令牌
├── router/
│   └── AppRoutes.tsx     # React Router 路由定义 + ProtectedRoute 守卫
├── layout/
│   └── AppShell.tsx      # 侧边栏 + 顶栏 + Outlet 布局
├── pages/                # 页面组件（15+）
├── components/           # UI 原子组件 + 业务组件
├── hooks/                # React Query 封装 hooks
├── api/                  # HTTP 请求适配器（按领域拆分）
└── lib/                  # 工具函数、query-keys、API client
```

## 路由

| 路径               | 页面               | 说明             |
| ------------------ | ------------------ | ---------------- |
| `/auth/login`      | LoginPage          | JWT 登录（公开） |
| `/`                | DashboardPage      | 总览仪表盘       |
| `/accounts/:id`    | ConversationPage   | 账号对话详情     |
| `/tools`           | ToolsPage          | 工具管理         |
| `/skills`          | SkillsPage         | 技能管理         |
| `/mcp`             | McpPage            | MCP Server 管理  |
| `/webhooks`        | WebhooksPage       | Webhook 管理     |
| `/scheduled-tasks` | ScheduledTasksPage | 定时任务         |
| `/model-config`    | ModelConfigPage    | 模型配置         |
| `/observability`   | ObservabilityPage  | 运行监控 Trace   |
| `/memory-graph`    | MemoryGraphPage    | 记忆图谱可视化   |

新增页面步骤：

1. `pages/` 创建页面组件
2. `router/AppRoutes.tsx` 添加路由
3. `layout/AppShell.tsx` 添加侧边栏菜单项（如需要）

## 数据流模式

```
Page → useXxx() hook → React Query → api/xxx.ts → fetch('/api/xxx')
                                                        ↓
                                              Vite proxy → localhost:8028
```

- **queryKeys**：`lib/query-keys.ts` 集中管理 cache key
- **hooks**：`hooks/use*.ts` 封装 `useQuery` / `useMutation`
- **API 适配器**：`api/*.ts` 纯 HTTP 调用，统一 Bearer token
- **认证**：JWT 存 localStorage，`lib/api.ts` 自动附加 Authorization header

## 设计系统（严格执行）

### Tailwind v4 CSS-first 主题约束（必须）

- 主题唯一真源：`src/styles.css` 的 `@theme` 块。
- 页面/组件样式必须优先消费主题类：`text-*` / `bg-*` / `border-*` / `shadow-*` / `rounded-*`。
- 只有两类例外允许脱离 `@theme`：
  - 运行时变量（必须放在 `:root`，例如透明混合色）。
  - 项目级复用样式（必须落在 `styles.css` 的 `@utility` 或命名 class）。
- 若现有 token 不够用：先补 token，再使用；禁止直接在页面里写任意值。

### 必须使用 @theme 设计令牌

```css
@theme {
  --color-paper: ...; /* 页面背景 */
  --color-surface: ...; /* 卡片/模块背景 */
  --color-ink: ...; /* 主文字 */
  --color-ink-secondary: ...; /* 辅助文字 */
  --color-accent: ...; /* 强调色 */
  --color-line: ...; /* 分隔线 */
}
```

### 页面设计约束（AI 必须遵守）

- 视觉零回归：只做抽象和复用，不允许擅自改变已有视觉风格。
- 页面层级靠间距建立：优先 `gap-*`、`space-y-*`、`py-*`，不要用重背景色硬分块。
- 分区优先轻分隔：使用 `border-b border-line` + 合理留白。
- 卡片/模块信息结构保持一致：标题区、动作区、主体区、补充信息区。
- 交互状态统一：hover/focus/active/disabled 均使用现有 token（特别是 focus ring 和阴影）。
- 新页面优先复用 `components/ui` 和已有业务组件，不重复造轮子。

### 禁止（硬约束）

- ❌ 任意值：`bg-[#f4f7f8]`, `text-[14px]`, `w-[320px]`
- ❌ 任意值变体：`bg-[rgba(...)]`, `border-[rgba(...)]`, `shadow-[...]`, `ring-[3px]`, `bg-[linear-gradient(...)]`
- ❌ 在 TSX 内写 `style={{ ... }}` 承担主题职责（布局临时值除外）
- ❌ 新增未注册 token 的颜色/圆角/阴影/字号
- ❌ 模块盒子：不用大容器包裹页面内容
- ❌ 深色背景块分隔：只用 `border-b` + 间距

### 设计原则

- **间距创建层次**：用 `gap-*`, `space-y-*` 而非颜色/边框区分区块
- **实体卡片五段式**：标题+副标题 | 状态+开关+菜单 | 指标 | 标签 | 元信息
- **轻量分隔**：`border-b border-line` 即可

### 新增样式的落地顺序（必须）

1. 先复用已有主题 token 和已有 class
2. 不够用时，在 `@theme` 新增 token（命名语义化）
3. 仍不够用时，在 `styles.css` 新增 `@utility` 或复用 class
4. 仅运行时场景使用 `:root` 变量，并写明用途

### AI 收尾流程（强制执行）

```bash
pnpm -F @clawbot/web lint:fix
pnpm -F @clawbot/web fmt
rg -n "text-\\[#|bg-\\[#|border-\\[#|shadow-\\[|ring-\\[[0-9]+px\\]|bg-\\[rgba|border-\\[rgba|bg-\\[linear-gradient" src
pnpm -F @clawbot/web build
```

- 每次 AI 修改了代码文件（`.ts/.tsx/.css`），必须至少执行 `lint:fix` 和 `fmt`。
- 若存在报错，AI 需要继续修复直到命令通过，再交付结果。

### 组件体系

- **UI 原子**：Button, Input, Dialog, Card 等（shadcn/ui 风格，无业务逻辑）
- **业务组件**：MemoryGraph, ObservabilityTimeline, MessageBubble
- **页面层**：组合 hooks + 组件，处理数据编排

## 路径别名

- `@/` 指向 `src/`（在 vite.config.ts 和 tsconfig.json 中配置）

## 开发命令

```bash
pnpm dev:web              # Vite dev server :5173
pnpm -F @clawbot/web build   # tsc --noEmit + vite build
```

## API 代理

Vite 开发服务器将 `/api` 代理到 `http://localhost:8028`。如果更改了服务端端口，需同步修改 `vite.config.ts` 中的 proxy 配置。

## 修改指南

- 新增页面 → `pages/` + `router/AppRoutes.tsx` + 侧边栏
- 新增 API 调用 → `api/` 适配器 + `hooks/` Query hook + `lib/query-keys.ts`
- 新增组件 → `components/` 下按类型放置
- 样式调整 → 只使用 `@theme` 令牌，参考 `styles.css`
