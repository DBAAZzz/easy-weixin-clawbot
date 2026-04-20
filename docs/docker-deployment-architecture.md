# Docker 化发布与部署方案

> 说明：当前实现已经取消 `packages/server/config.yaml`，认证统一改为仓库根 `.env` 中的 `AUTH_*` 环境变量。本文中保留的 `config.yaml` 讨论代表当时的设计上下文，不再是当前运行时入口。

> 本文档以**当前仓库真实代码实现**为前提，定义 Docker 发布的第一版可落地方案。  
> 它不是“最终最优镜像形态”，而是“在不先做大规模代码重构的情况下，如何把项目稳定发布出去”。

## 1. 目标

Docker 化的目标是把开源用户入口从：

- `pnpm dev`

切换为：

- `docker compose up --build -d`

对应的角色边界：

| 角色 | 入口 | 说明 |
|------|------|------|
| 开源用户 | `docker compose up --build -d` | 不依赖宿主机 Node.js / pnpm / PostgreSQL |
| 贡献者 | `pnpm dev` | 本地开发、热重载、调试 |

## 2. 当前代码实现的关键事实

在设计 Docker 方案前，必须先承认当前代码的真实边界。

### 2.1 微信登录态已经入库

当前微信运行态的核心数据已经进入 PostgreSQL：

- `weixin_account_credentials`
- `weixin_account_allow_from`
- `weixin_sync_state`
- `accounts`

这意味着：

- 微信登录态不再依赖 `~/.openclaw`
- Server 启动时不会再从本地状态目录回灌账号
- 只要数据库卷保留，已绑定账号就应具备恢复基础

### 2.2 Server 启动链路以数据库为主

当前 [packages/server/src/runtime.ts](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/src/runtime.ts:1) 会：

1. 查询未废弃账号
2. 读取数据库中的加密凭据
3. 读取数据库中的 `sync_buf`
4. 拉起微信账号运行时

这与 Docker 化方案是匹配的。

### 2.3 `config.yaml` 仍然是应用层配置入口

当前 [packages/server/src/config/auth.ts](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/src/config/auth.ts:12) 通过：

```ts
resolve(process.cwd(), "config.yaml")
```

加载后台登录配置。

这意味着：

- Docker 部署不能假设认证配置已经完全 env 化
- 容器运行时必须让 `packages/server/config.yaml` 可用

### 2.4 `data/` 仍然是运行时目录

当前 [packages/server/src/paths.ts](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/src/paths.ts:4) 会把仓库根目录下的 `data/` 作为运行时目录，Server 会依赖它读取：

- `data/tools/builtin`
- `data/tools/user`
- `data/skills/builtin`
- `data/skills/user`
- `data/downloads`
- `data/media-cache`
- `data/tts-cache`

另外，工具与技能的安装状态当前也通过：

- `data/tools/state.json`
- `data/skills/state.json`

持久化。

结论：

- 微信登录态已经脱离本地目录
- 但 `data/` 目录仍然承担工具、技能、缓存和部分运行时状态职责

### 2.5 当前 workspace 运行时还不能按“纯 dist-only”处理

这是本方案最重要的现实约束。

当前这些包的运行时导出还没有全部统一到 `dist`：

- [packages/agent/package.json](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/agent/package.json:6)
- [packages/observability/package.json](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/observability/package.json:6)
- [packages/weixin-agent-sdk/package.json](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/weixin-agent-sdk/package.json:7)

它们仍然指向 `src/*.ts` 或 `index.ts`。

这意味着 Docker 第一版**不能假设**只复制：

- `packages/server/dist`
- 若干 workspace 包的 `dist`
- 生产依赖 `node_modules`

就能稳定运行。

### 2.6 Prisma 初始化当前依赖开发链路

当前 `server` 的 Prisma 命令是：

- [packages/server/package.json](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/package.json:12)

也就是：

- `prisma:generate` → `tsx src/prisma-cli.ts generate`
- `prisma:push` → `tsx src/prisma-cli.ts db push`

同时：

- `prisma`
- `tsx`

都还在 `devDependencies`。

因此 Docker 第一版里如果还需要在容器启动时做 schema 同步，就**不能**先把运行镜像裁成纯 production 依赖。

## 3. Docker 第一版推荐架构

### 3.1 容器拓扑

推荐保持 3 个容器：

1. `nginx`
2. `server`
3. `postgres`

流量路径：

```text
Browser
  -> nginx
     -> /        Web 静态资源
     -> /api/*   server
                    -> postgres
                    -> 外部 LLM / 微信接口
                    -> /app/data
```

### 3.2 各容器职责

`nginx`
- 托管 Web 静态资源
- 将 `/api` 反代到 `server`
- 提供 SPA history fallback

`server`
- Hono API
- 微信登录与运行时恢复
- Agent、Scheduler、Webhook、MCP
- 从 DB 读取微信凭据
- 依赖 `/app/data` 和 `packages/server/config.yaml`

`postgres`
- 持久化业务数据
- 持久化微信登录态与同步状态

### 3.3 单实例是默认前提

当前没有账号级租约机制，因此第一版发布默认前提是：

- 只跑一个 `server` 实例

否则多个实例可能同时拉起同一个微信账号。

## 4. 当前代码兼容的构建策略

### 4.1 构建上下文必须是仓库根目录

因为当前是 pnpm workspace Monorepo，Docker 构建必须以仓库根为上下文，而不是只在 `packages/server` 下构建。

### 4.2 使用多阶段构建，但第一版优先正确性

推荐分为：

1. `builder`
2. `server-runtime`
3. `web-runtime`

但第一版的核心原则不是“镜像最小”，而是“先稳定跑起来”。

### 4.3 Builder 阶段

Builder 阶段建议：

1. 复制根目录依赖元文件
2. 复制各 workspace `package.json`
3. `pnpm install --frozen-lockfile`
4. 再复制完整源码
5. 执行 `pnpm build`

这样既符合 Monorepo 构建顺序，也能利用 Docker layer cache。

### 4.4 Server Runtime 阶段

当前代码实现下，Server 运行镜像建议直接保留：

- 根级 `node_modules`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `packages/server`
- `packages/agent`
- `packages/observability`
- `packages/shared`
- `packages/weixin-agent-sdk`
- `data`

也就是说，**第一版不要把 Server 镜像收缩成“只剩 dist 的 ultra-slim 运行时”**。

原因有三个：

1. workspace 包当前仍有源码级导出
2. `server` 启动前还要执行 `pnpm -F @clawbot/server prisma:push`
3. `packages/agent/prompts/*.md` 需要作为运行时文件保留

### 4.5 当前阶段不要做 `pnpm prune --prod`

这一点需要明确写死：

- 第一版 Server 镜像**不要**做 `pnpm prune --prod`

因为一旦裁掉开发依赖，当前容器内的这些能力会直接失效：

- `prisma`
- `tsx`
- `pnpm -F @clawbot/server prisma:push`

等后续满足下面两个条件后，再考虑瘦身：

1. workspace 包运行时入口统一收敛到 `dist`
2. 数据库初始化流程改成不依赖当前 dev 工具链

### 4.6 Web Runtime 阶段

Web 端可以保持轻量：

- 构建阶段产出 `packages/web/dist`
- 最终镜像基于 `nginx:alpine`
- 只复制静态资源和 Nginx 配置

## 5. 启动与数据库初始化策略

### 5.1 当前阶段用 `prisma:push`

当前仓库不是 migration-first，第一版部署应与代码现实保持一致：

- 启动前执行 `pnpm -F @clawbot/server prisma:push`

而不是直接写成：

- `prisma migrate deploy`

### 5.2 推荐的 Server 入口步骤

`server-entrypoint.sh` 建议做这几步：

1. 等待 PostgreSQL 可用
2. 执行 `pnpm -F @clawbot/server prisma:push`
3. 处理 `data/` 初始化
4. 执行 `pnpm -F @clawbot/server start`

推荐启动逻辑：

```text
wait-for-postgres
  -> pnpm -F @clawbot/server prisma:push
  -> init-data-layout
  -> pnpm -F @clawbot/server start
```

### 5.3 Compose 层健康检查

建议：

- `postgres` 使用 `pg_isready`
- `server` 使用现成的 `/api/health`

这样可以把启动顺序收敛为：

```text
postgres healthy -> server healthy -> nginx
```

## 6. `data/` 挂载边界

这一部分必须和当前代码保持一致，否则文档会自相矛盾。

### 6.1 哪些数据必须进数据库

以下内容已经以数据库为唯一真相源：

- 微信凭据
- 微信授权关系
- 微信 `sync_buf`
- 账号元信息

### 6.2 哪些内容仍然在 `/app/data`

当前 `/app/data` 仍承担：

- 内置工具定义
- 用户工具定义
- 内置技能定义
- 用户技能定义
- 工具/技能状态文件
- 下载缓存
- 媒体缓存
- TTS 缓存

### 6.3 如果挂载整个 `/app/data`，必须做初始化补种

如果 Compose 直接把一个空 named volume 挂到：

- `/app/data`

那么镜像内原本自带的：

- `data/tools/builtin`
- `data/skills/builtin`
- `data/tools/state.json`
- `data/skills/state.json`

都会被空卷覆盖。

因此第一版如果要挂整个 `/app/data`，就必须在 Docker 层补一套逻辑：

1. 镜像中额外保留一份只读备份目录，例如 `/app/data-builtin`
2. entrypoint 在首次启动时把 builtin 文件和 `state.json` 补到 volume

否则：

- Server 能启动
- 但 builtin 工具/技能会丢失
- 状态文件也会丢失

### 6.4 推荐取舍

当前代码下，推荐这样定义优先级：

1. `pgdata` 是必保留卷
2. `/app/data` 是建议保留卷
3. 但挂载 `/app/data` 时必须配套“builtin 补种”逻辑

换句话说：

- 微信登录态恢复依赖 PostgreSQL
- 工具/技能与缓存恢复依赖 `/app/data`
- 两者职责已经分开，但 `/app/data` 不能被粗暴挂空卷后不做初始化

## 7. 配置模型

### 7.1 Docker 层与应用层分离

推荐保留两层配置：

`Compose 层`
- 仓库根 `.env`
- 用于数据库、端口、LLM Key、`CLAWBOT_CREDENTIAL_KEY`

`应用层`
- `packages/server/config.yaml`
- 用于后台用户名、密码、JWT Secret、过期时间

### 7.2 当前认证真实来源是 `config.yaml`

当前 Web 管理后台认证主链路来自：

- [packages/server/src/config/auth.ts](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/src/config/auth.ts:12)

也就是 `config.yaml`。

虽然当前启动检查里还会出现：

- [packages/server/src/ai.ts](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/src/ai.ts:125)

的 `API_SECRET` warning，但 Docker 文档不应把它当成当前主认证配置源。

### 7.3 `CLAWBOT_CREDENTIAL_KEY` 是生产必填项

当前 [packages/server/src/credentials/crypto.ts](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/src/credentials/crypto.ts:34) 已经定义：

- 非生产环境未设置：退回 dev-only key
- 生产环境未设置：直接抛错拒绝启动

因此 Docker 文档中应明确：

- `CLAWBOT_CREDENTIAL_KEY` 是生产必填项

## 8. Nginx 边界

当前 Web 已经走相对路径 `/api`，因此第一版 Nginx 只需要做好：

1. SPA history fallback
2. `/api` 反向代理
3. 透传代理头：
   - `Host`
   - `X-Real-IP`
   - `X-Forwarded-For`
   - `X-Forwarded-Proto`

当前不需要为了前端再设计额外的运行时 `API_URL` 注入机制。

## 9. 交付文件建议

第一版 Docker 化建议新增这些文件：

- `Dockerfile`
- `docker-compose.yml`
- `docker/server-entrypoint.sh`
- `docker/nginx.conf`
- 仓库根 `.env.example`

认证配置模板当前仓库里已经有：

- [packages/server/config-example.yaml](/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/packages/server/config-example.yaml)

第一版可以继续复用它，不必先额外发明一套新的认证配置格式。

## 10. 第一版验证清单

落地后应至少验证这些点：

- `docker compose up --build -d` 后三容器正常启动
- 浏览器访问 Nginx 暴露地址可以看到后台登录页
- `packages/server/config.yaml` 认证可正常登录
- `/api/health` 可访问
- 扫码绑定微信账号后，凭据写入数据库
- `docker compose down` 再 `docker compose up -d` 后，已绑定账号无需重新扫码
- 如果挂载了 `/app/data`，builtin 工具/技能与 `state.json` 不会在首次启动后丢失

## 11. 后续优化方向

当前文档故意没有把第一版写成“最瘦镜像方案”，因为那需要先做代码侧收口。

后续优化可以按这个顺序推进：

1. 把 `agent / observability / weixin-agent-sdk` 的运行时导出统一收敛到 `dist`
2. 让 Server 运行镜像摆脱对 `tsx` / `prisma` devDependencies 的依赖
3. 从 `prisma db push` 过渡到 `prisma migrate deploy`
4. 再收缩 Server 镜像，只复制真正的运行时产物

也就是说：

- 第一版优先“按当前代码稳定跑”
- 第二版再追求“镜像更薄、更规整”

## 相关文档

- [微信登录态与账号凭据存储改造方案](./weixin-login-state-storage-design.md)
- [Web 架构](./web-architecture.md)
- [JWT 认证](./jwt-authentication.md)
- [Agent 架构](./agent-architecture.md)
