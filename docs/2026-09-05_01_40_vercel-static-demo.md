# 在线演示：Vercel 纯静态部署（MSW Mock）

> 推荐的「分享链接」预览方案：Vercel 上托管一个纯静态站点，`/api/*` 由
> MSW（Mock Service Worker）在浏览器内应答。**零后端、零数据库、永不休眠**，
> 任何人打开链接即可浏览带演示数据的完整后台并做会话内交互。
>
> 前置阅读：[演示模式说明](./2026-09-05_00_26_demo-preview-mode.md)。

## 原理

- `packages/web/src/mocking/fixtures.json`：由 `pnpm -F @clawbot/server
  demo:snapshot-fixtures` 从真实 `DEMO_MODE` API **原样快照**的响应数据
  （形状即接口契约，不是手写的猜测）。
- `packages/web/src/mocking/handlers.ts`：MSW 请求处理器——读路径回放
  fixtures，写路径（启停任务、编辑、增删等）修改内存 store。
- `packages/web/src/main.tsx`：仅当构建时 `VITE_API_MOCK=1` 才动态加载 mock
  模块；正常构建完全不含该代码。
- 交互是**会话内生效、刷新重置**——演示场景刻意不持久化访问者的修改。
- 未模拟的 `/api/*` 会返回 501，页面以 toast 明确提示「演示环境未模拟该操作」，
  不会静默失败。

## 部署到 Vercel（约 3 分钟）

1. Vercel 控制台 → Add New Project → 导入本仓库。
2. **Root Directory 设为 `packages/web`**（Vite 会被自动识别）。
3. 在 Project → Settings → Environment Variables 添加一个变量：
   - `VITE_API_MOCK` = `1`
4. Deploy。得到的 `https://<project>.vercel.app` 即分享链接。

登录页任意非空用户名/密码即可进入（mock 不校验凭据）。

## 本地预览

```bash
VITE_API_MOCK=1 pnpm -F @clawbot/web build
pnpm -F @clawbot/web exec vite preview   # http://localhost:4173
```

开发模式同样生效：`VITE_API_MOCK=1 pnpm dev:web`（无需启动后端）。

## 维护：API 形状变化后同步 fixtures

mock 的数据形状来自真实接口的快照。当 `/api` 响应结构变化、或想更新演示内容时：

```bash
# 用任一可达的 Postgres + 演示环境变量重新生成 fixtures.json
DATABASE_URL=... DIRECT_URL=... AUTH_PASSWORD=... \
  pnpm -F @clawbot/server demo:snapshot-fixtures
```

脚本会重建演示数据、登录并抓取全部 web 依赖的接口，改写
`packages/web/src/mocking/fixtures.json`。新增页面/接口时，在
`packages/web/src/mocking/handlers.ts` 补对应 handler 即可；未覆盖的请求会
触发 501 提示，便于发现遗漏。

## 与 serverless 真后端方案的关系

若需要「交互完全真实」（定时任务真的执行、数据真的持久化），参见
[Vercel serverless 部署](./2026-09-05_00_34_vercel-demo-deployment.md)——
那需要外部 Postgres 且有冷启动；纯预览场景用本方案即可。
