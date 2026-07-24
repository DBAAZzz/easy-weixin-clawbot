#!/usr/bin/env bash
# 封锁 node:child_process：仓库内只允许 @clawbot/exec 及豁免清单使用。
# 见 docs/2026-07-23_21_30_exec-package-design.md §8
set -euo pipefail
cd "$(dirname "$0")/.."

allowed_pattern='^packages/exec/src/|^packages/server/src/prisma-cli\.ts$|\.test\.ts$|/test/'

violations=$(grep -rln --include='*.ts' \
  -e 'node:child_process' -e '"child_process"' -e "'child_process'" \
  packages 2>/dev/null \
  | grep -v node_modules \
  | grep -vE "$allowed_pattern" || true)

if [ -n "$violations" ]; then
  echo "❌ 以下文件绕过 @clawbot/exec 直接使用 child_process："
  echo "$violations"
  echo "请改用 @clawbot/exec 的 run()/spawnService()。豁免需修改本脚本并更新设计文档。"
  exit 1
fi
echo "✅ child_process fence OK"
