# ============================================================================
# Build args — set REGISTRY to a mirror for China users, e.g.:
#   docker compose build --build-arg REGISTRY=docker.m.daocloud.io/library/
# ============================================================================
ARG REGISTRY=

# ============================================================================
# Stage 1: Builder — install deps + build all packages
# ============================================================================
FROM ${REGISTRY}node:22-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate

WORKDIR /app

# -- Layer 1: dependency metadata (cached unless lockfile changes) -----------
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json          packages/shared/
COPY packages/observability/package.json   packages/observability/
COPY packages/agent/package.json           packages/agent/
COPY packages/server/package.json          packages/server/
COPY packages/web/package.json             packages/web/
COPY packages/weixin-agent-sdk/package.json packages/weixin-agent-sdk/
COPY packages/weixin-acp/package.json      packages/weixin-acp/

# Prefetch packages before copying sources so Docker can reuse this layer
# without triggering root postinstall scripts that depend on workspace files.
RUN pnpm fetch --frozen-lockfile

# -- Layer 2: full source ---------------------------------------------------
COPY packages/ packages/

# Copy only builtin tools/skills + state files (user content comes from volume)
COPY data/tools/state.json   data/tools/state.json
COPY data/tools/builtin/     data/tools/builtin/
COPY data/skills/state.json  data/skills/state.json
COPY data/skills/builtin/    data/skills/builtin/

# Drop any incremental TypeScript caches copied from the host. Stale
# tsbuildinfo files can make `tsc` skip emit in a clean container build.
RUN find packages -name '*.tsbuildinfo' -delete

# Create empty user directories
RUN mkdir -p data/tools/user data/skills/user

# Install dependencies after sources exist so root postinstall can generate
# Prisma Client. Use placeholder Prisma URLs because `generate` does not need a
# live database connection, only env vars that satisfy the schema loader.
RUN DATABASE_URL=postgresql://clawbot:clawbot@localhost:5432/clawbot \
    DIRECT_URL=postgresql://clawbot:clawbot@localhost:5432/clawbot \
    pnpm install --frozen-lockfile --offline

# -- Layer 3: build (topological order matches root package.json "build") ----
RUN pnpm build


# ============================================================================
# Stage 2: Server runtime
# ============================================================================
ARG REGISTRY=
FROM ${REGISTRY}node:22-slim AS server

# Install pnpm + openssl (Prisma needs it)
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate \
    && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace metadata
COPY --from=builder /app/package.json       /app/package.json
COPY --from=builder /app/pnpm-lock.yaml     /app/pnpm-lock.yaml
COPY --from=builder /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml

# Copy all node_modules (including workspace links)
COPY --from=builder /app/node_modules/      /app/node_modules/

# Copy workspace packages (source + dist — needed because some packages export src/*.ts)
COPY --from=builder /app/packages/shared/      /app/packages/shared/
COPY --from=builder /app/packages/observability/ /app/packages/observability/
COPY --from=builder /app/packages/agent/       /app/packages/agent/
COPY --from=builder /app/packages/server/      /app/packages/server/
COPY --from=builder /app/packages/weixin-agent-sdk/ /app/packages/weixin-agent-sdk/
COPY --from=builder /app/packages/weixin-acp/  /app/packages/weixin-acp/

# The repository keeps some workspace packages pointed at source files for local
# development. Inside the runtime image we must execute built artifacts only.
RUN node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";

function rewriteWorkspacePackage(path, options) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  const { sourcePrefix, distPrefix, runtimeExt, typesExt } = options;

  function rewriteValue(value, kind = "runtime") {
    if (typeof value !== "string" || !value.endsWith(".ts")) {
      return value;
    }

    const prefix = value.startsWith(sourcePrefix) ? sourcePrefix : null;
    if (!prefix) {
      return value;
    }

    const stem = value.slice(prefix.length, -3);
    return `${distPrefix}${stem}${kind === "types" ? typesExt : runtimeExt}`;
  }

  function rewriteExports(node) {
    if (typeof node === "string") {
      return rewriteValue(node);
    }

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      return node;
    }

    const rewritten = {};
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string") {
        rewritten[key] = rewriteValue(value, key === "types" ? "types" : "runtime");
      } else {
        rewritten[key] = rewriteExports(value);
      }
    }
    return rewritten;
  }

  if (typeof pkg.main === "string") {
    pkg.main = rewriteValue(pkg.main);
  }
  if (typeof pkg.types === "string") {
    pkg.types = rewriteValue(pkg.types, "types");
  }
  if (pkg.exports) {
    pkg.exports = rewriteExports(pkg.exports);
  }

  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}

rewriteWorkspacePackage("/app/packages/agent/package.json", {
  sourcePrefix: "./src/",
  distPrefix: "./dist/",
  runtimeExt: ".js",
  typesExt: ".d.ts",
});

rewriteWorkspacePackage("/app/packages/observability/package.json", {
  sourcePrefix: "./src/",
  distPrefix: "./dist/",
  runtimeExt: ".js",
  typesExt: ".d.ts",
});

rewriteWorkspacePackage("/app/packages/weixin-agent-sdk/package.json", {
  sourcePrefix: "./",
  distPrefix: "./dist/",
  runtimeExt: ".mjs",
  typesExt: ".d.mts",
});
EOF

# Copy data (builtin tools/skills + state files)
COPY --from=builder /app/data/ /app/data/

# Create a read-only backup of builtin data for volume initialization
RUN cp -a /app/data /app/data-builtin

# Create runtime directories
RUN mkdir -p /app/data/downloads /app/data/media-cache /app/data/tts-cache

# Copy entrypoint
COPY docker/server-entrypoint.sh /app/docker/server-entrypoint.sh
RUN chmod +x /app/docker/server-entrypoint.sh

# Default environment
ENV NODE_ENV=production
ENV API_PORT=8028

EXPOSE 8028

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8028/api/health || exit 1

ENTRYPOINT ["/app/docker/server-entrypoint.sh"]


# ============================================================================
# Stage 3: Web (nginx serving static assets)
# ============================================================================
ARG REGISTRY=
FROM ${REGISTRY}nginx:1.27-alpine AS web

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built web assets
COPY --from=builder /app/packages/web/dist/ /usr/share/nginx/html/

EXPOSE 80
