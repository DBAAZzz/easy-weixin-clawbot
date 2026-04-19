#!/bin/sh
set -e

# ============================================================================
# ClawBot Server Entrypoint
# Handles: PostgreSQL readiness → Prisma push → data init → server start
# ============================================================================

echo "[entrypoint] Starting ClawBot Server..."

# --------------------------------------------------------------------------
# 1. Wait for PostgreSQL to be ready
# --------------------------------------------------------------------------
wait_for_postgres() {
  local max_attempts=30
  local attempt=0

  echo "[entrypoint] Waiting for PostgreSQL..."

  while [ $attempt -lt $max_attempts ]; do
    # Use Node.js to test the database connection since pg_isready is not installed
    if node -e "
      const url = process.env.DATABASE_URL || '';
      if (!url) { process.exit(1); }
      import('node:net').then(net => {
        const u = new URL(url);
        const sock = net.createConnection({ host: u.hostname, port: Number(u.port) || 5432 }, () => {
          sock.end();
          process.exit(0);
        });
        sock.on('error', () => process.exit(1));
        sock.setTimeout(2000, () => { sock.destroy(); process.exit(1); });
      });
    " 2>/dev/null; then
      echo "[entrypoint] PostgreSQL is ready."
      return 0
    fi

    attempt=$((attempt + 1))
    echo "[entrypoint] PostgreSQL not ready (attempt $attempt/$max_attempts), retrying in 2s..."
    sleep 2
  done

  echo "[entrypoint] ERROR: PostgreSQL not reachable after $max_attempts attempts."
  exit 1
}

# --------------------------------------------------------------------------
# 2. Initialize data directory (builtin seeding for mounted volume)
# --------------------------------------------------------------------------
init_data_layout() {
  echo "[entrypoint] Checking data directory..."

  # If /app/data/tools/builtin is empty or missing, seed from backup
  if [ ! -d "/app/data/tools/builtin" ] || [ -z "$(ls -A /app/data/tools/builtin 2>/dev/null)" ]; then
    echo "[entrypoint] Seeding builtin tools..."
    mkdir -p /app/data/tools/builtin
    cp -a /app/data-builtin/tools/builtin/. /app/data/tools/builtin/
  fi

  if [ ! -d "/app/data/skills/builtin" ] || [ -z "$(ls -A /app/data/skills/builtin 2>/dev/null)" ]; then
    echo "[entrypoint] Seeding builtin skills..."
    mkdir -p /app/data/skills/builtin
    cp -a /app/data-builtin/skills/builtin/. /app/data/skills/builtin/
  fi

  # Seed state.json files if missing
  if [ ! -f "/app/data/tools/state.json" ] && [ -f "/app/data-builtin/tools/state.json" ]; then
    echo "[entrypoint] Seeding tools state.json..."
    cp /app/data-builtin/tools/state.json /app/data/tools/state.json
  fi

  if [ ! -f "/app/data/skills/state.json" ] && [ -f "/app/data-builtin/skills/state.json" ]; then
    echo "[entrypoint] Seeding skills state.json..."
    cp /app/data-builtin/skills/state.json /app/data/skills/state.json
  fi

  # Ensure user directories exist
  mkdir -p /app/data/tools/user
  mkdir -p /app/data/skills/user
  mkdir -p /app/data/downloads
  mkdir -p /app/data/media-cache
  mkdir -p /app/data/tts-cache

  echo "[entrypoint] Data directory ready."
}

# --------------------------------------------------------------------------
# 3. Run Prisma DB push (schema sync)
# --------------------------------------------------------------------------
run_prisma_push() {
  echo "[entrypoint] Running Prisma schema push..."
  cd /app
  pnpm -F @clawbot/server prisma:push
  echo "[entrypoint] Prisma schema push complete."
}

# --------------------------------------------------------------------------
# 4. Copy config.yaml if not present
# --------------------------------------------------------------------------
init_config() {
  if [ ! -f "/app/packages/server/config.yaml" ]; then
    if [ -f "/app/packages/server/config-example.yaml" ]; then
      echo "[entrypoint] No config.yaml found, copying from config-example.yaml..."
      cp /app/packages/server/config-example.yaml /app/packages/server/config.yaml
    else
      echo "[entrypoint] WARNING: No config.yaml and no config-example.yaml found."
    fi
  fi
}

# --------------------------------------------------------------------------
# Execute steps in order
# --------------------------------------------------------------------------
wait_for_postgres
init_data_layout
init_config
run_prisma_push

echo "[entrypoint] Starting server..."
cd /app/packages/server
exec node dist/index.js
