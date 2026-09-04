# Vercel 演示环境部署指南

> 目标：把演示环境托管到 Vercel，得到一个可以分享的链接，别人打开就能看到带
> 演示数据的完整后台（登录 + 全部页面渲染 + 增删改查交互）。
>
> 前置阅读：[演示模式说明](./2026-09-05_00_26_demo-preview-mode.md)。

## 架构与边界

| 组件 | 在 Vercel 上的形态 |
|------|--------------------|
| Web 后台（React SPA） | 静态资源，`vercel.json` 的 `outputDirectory` 直接托管 |
| API（Hono） | Serverless Function：`api/[[route]].ts` → `packages/server/src/api/vercel-demo.ts` |
| PostgreSQL | **不随部署运行**，使用外部免费的托管 Postgres（Supabase / Neon 免费档） |
| 微信运行时 / 调度器 / MCP 进程 | **不运行**（serverless 没有常驻进程；演示账号本来就没有微信凭据，页面不受影响） |

serverless 入口与长驻模式的差异：

- 启动即构建 API 应用，**跳过**微信运行时、调度器、RSS、心跳与 MCP 连接；
- 冷启动时执行一次演示 seed，且带 `skipIfPresent` —— 数据已存在就直接跳过，
  不会在热实例服务请求时被另一个冷启动实例删改。

## 部署步骤（约 10 分钟）

### 1. 创建免费的托管 Postgres

- [Supabase](https://supabase.com)：新建项目 → Project Settings → Database →
  复制连接串。`DATABASE_URL` 用 Session/Transaction pooler 串，
  `DIRECT_URL` 用直连串（参考仓库根 `.env.example` 里的说明）。
- 或 [Neon](https://neon.tech)：新建项目后复制 pooled / direct 两个连接串。

注意：Supabase 免费项目闲置约一周会被暂停，演示链接会打不开，需要到控制台
恢复；Neon 闲置会缩容到零但会自动唤醒（首次访问慢几秒）。

### 2. 从本地把 migration 推到云端库（一次性）

```bash
DATABASE_URL="<云端 DATABASE_URL>" \
DIRECT_URL="<云端 DIRECT_URL>" \
pnpm -F @clawbot/server prisma:migrate:deploy
```

### 3. 导入仓库到 Vercel

Vercel 控制台 → Add New Project → 导入本仓库，**Root Directory 保持仓库根**，
框架检测会读到根目录 `vercel.json`（构建命令 `pnpm build`，静态产物
`packages/web/dist`，`api/[[route]].ts` 自动成为 serverless 函数）。

### 4. 配置环境变量（Project → Settings → Environment Variables）

| 变量 | 值 |
|------|----|
| `DEMO_MODE` | `true` |
| `DATABASE_URL` | 步骤 1 的连接串 |
| `DIRECT_URL` | 步骤 1 的直连串 |
| `CLAWBOT_CREDENTIAL_KEY` | 任意 64 位十六进制（演示值即可，如 `docker/demo.env` 里的） |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | 演示登录账号，如 `admin` / `demo-admin-2026` |
| `AUTH_JWT_SECRET` | 任意足够长的随机串（可用 `docker/demo.env` 里的演示值） |

### 5. 部署并分享

Deploy 完成后得到 `https://<project>.vercel.app`，访问后用步骤 4 的账号密码
登录。首次打开会经历 serverless 冷启动（约 3–8 秒），之后很快。

## 日常维护

- **刷新演示数据**（相对时间戳会随时间变旧）：用后台账号登录拿到 token 后
  `POST /api/demo/seed`：

  ```bash
  curl -X POST "https://<project>.vercel.app/api/demo/seed" \
    -H "Authorization: Bearer <token>"
  ```

  或者直接在 Vercel 控制台 Redeploy 一次（数据库里的数据不受部署影响，
  Redeploy 不会刷新数据，仅 `POST /api/demo/seed` 会）。
- **修改演示内容**：改 `packages/server/src/seed/demo-data.ts` /
  `demo-seed.ts` 后提交，Vercel 自动重新构建，再调一次上面的 seed 接口。

## 已知限制

- 定时任务不会自动触发（没有常驻调度器），任务页只展示配置与历史；
- 微信扫码绑定不可用（没有常驻运行时，演示也不需要）；
- serverless 冷启动首请求偏慢；免费 Postgres 有限流与闲置策略（见步骤 1）；
- `vercel.json` 的函数配置（`includeFiles`、`maxDuration`）按 Vercel 当前
  平台约定编写；若平台行为变化，首次部署时可能需要按报错微调。
