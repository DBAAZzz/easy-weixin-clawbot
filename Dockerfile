# ============================================================================
# 构建参数 — 为中国大陆用户设置镜像源，例如：
#   docker compose build --build-arg REGISTRY=docker.m.daocloud.io/library/
# ============================================================================
ARG REGISTRY=

# ============================================================================
# 阶段 1: Builder (构建器) — 安装依赖并编译所有软件包
# ============================================================================
FROM ${REGISTRY}node:22-slim AS builder

# 安装 pnpm (利用 Node.js 自带的 corepack)
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate

# 设置工作目录
WORKDIR /app

# -- 第 1 层: 依赖元数据 (除非 lockfile 改变，否则利用缓存) -----------
# 仅拷贝各个包的 package.json，这样在源码改变但依赖没变时，不需要重新下载依赖
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json          packages/shared/
COPY packages/observability/package.json   packages/observability/
COPY packages/agent/package.json           packages/agent/
COPY packages/server/package.json          packages/server/
COPY packages/web/package.json             packages/web/
COPY packages/weixin-agent-sdk/package.json packages/weixin-agent-sdk/
COPY packages/weixin-acp/package.json      packages/weixin-acp/

# 在拷贝源码之前预下载包，这样 Docker 缓存层可以重用，避免触发依赖源码的脚本
RUN pnpm fetch --frozen-lockfile

# -- 第 2 层: 完整源码 ---------------------------------------------------
# 拷贝所有包的源代码
COPY packages/ packages/

# 拷贝内置的工具/技能定义和状态文件 (用户自定义内容将通过挂载卷提供)
COPY data/tools/state.json   data/tools/state.json
COPY data/tools/builtin/     data/tools/builtin/
COPY data/skills/state.json  data/skills/state.json
COPY data/skills/builtin/    data/skills/builtin/

# 删除从宿主机拷贝过来的 TypeScript 增量编译缓存。
# 过时的 .tsbuildinfo 文件可能会导致容器内编译时跳过某些文件的生成。
RUN find packages -name '*.tsbuildinfo' -delete

# 创建空的目录用于存放用户数据
RUN mkdir -p data/tools/user data/skills/user

# 在源码存在后安装依赖，以便触发根目录的 postinstall 脚本生成 Prisma Client。
# 这里使用占位符数据库 URL，因为 `prisma generate` 只需要解析 schema，不需要真实连接。
RUN DATABASE_URL=postgresql://clawbot:clawbot@localhost:5432/clawbot \
    DIRECT_URL=postgresql://clawbot:clawbot@localhost:5432/clawbot \
    pnpm install --frozen-lockfile --offline

# -- 第 3 层: 编译 (按照 root package.json 中定义的拓扑顺序编译) ----
RUN pnpm build


# ============================================================================
# 阶段 2: Server 运行环境 (后端)
# ============================================================================
ARG REGISTRY=
FROM ${REGISTRY}node:22-slim AS server

# 安装 pnpm 和 openssl (Prisma 运行必需组件)
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate \
    && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从构建器阶段拷贝工作空间元数据
COPY --from=builder /app/package.json       /app/package.json
COPY --from=builder /app/pnpm-lock.yaml     /app/pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml

# 拷贝所有的 node_modules (包含工作空间的软链接)
COPY --from=builder /app/node_modules/      /app/node_modules/

# 拷贝各软件包的编译产物和必要源码
COPY --from=builder /app/packages/shared/      /app/packages/shared/
COPY --from=builder /app/packages/observability/ /app/packages/observability/
COPY --from=builder /app/packages/agent/       /app/packages/agent/
COPY --from=builder /app/packages/server/      /app/packages/server/
COPY --from=builder /app/packages/weixin-agent-sdk/ /app/packages/weixin-agent-sdk/
COPY --from=builder /app/packages/weixin-acp/  /app/packages/weixin-acp/

# 拷贝初始数据 (内置工具/技能 + 状态文件)
COPY --from=builder /app/data/ /app/data/

# 创建内置数据的只读备份，用于在容器首次启动时初始化挂载卷
RUN cp -a /app/data /app/data-builtin

# 创建运行时所需的目录
RUN mkdir -p /app/data/downloads /app/data/media-cache /app/data/tts-cache

# 拷贝并设置启动脚本权限
COPY docker/server-entrypoint.sh /app/docker/server-entrypoint.sh
RUN chmod +x /app/docker/server-entrypoint.sh

# 设置默认环境变量
ENV NODE_ENV=production
ENV API_PORT=8028

# 暴露后端端口
EXPOSE 8028

# 健康检查：每30秒检查一次后端 API 是否存活
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8028/api/health || exit 1

# 指定启动入口脚本
ENTRYPOINT ["/app/docker/server-entrypoint.sh"]


# ============================================================================
# 阶段 3: Web (前端 Nginx)
# ============================================================================
ARG REGISTRY=
FROM ${REGISTRY}nginx:1.27-alpine AS web

# 删除 Nginx 默认的配置文件
RUN rm /etc/nginx/conf.d/default.conf

# 拷贝项目自定义的 Nginx 配置
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# 从构建器阶段拷贝前端编译出的静态资源到 Nginx 目录
COPY --from=builder /app/packages/web/dist/ /usr/share/nginx/html/

# 暴露 80 端口
EXPOSE 80