import type { EnvSpec } from "./types.js";

/**
 * 明确排除且不得加入白名单（理由）：
 * - NODE_OPTIONS / NODE_REPL_*：对 Node 子进程（npx 系 MCP server）是代码注入向量。
 * - NODE_ENV：行为分歧源，需要的进程自行显式配置。
 * - 一切形如 *_KEY / *_SECRET / *_TOKEN / DATABASE_URL 的变量：这正是本方案要挡的东西，
 *   靠「白名单默认不含」而非「黑名单枚举」。
 */

/** 精确匹配的安全键。 */
const SAFE_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TERM",
  "LANG",
  "TZ",
  // 代理与出网配置（大小写两种写法都是生态惯例）
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  // 企业自签 CA 场景需要；本身不是秘密
  "NODE_EXTRA_CA_CERTS",
]);

/** 前缀匹配的安全键。 */
const SAFE_PREFIXES = ["LC_"];

/** win32 额外白名单（保持可移植；darwin/linux 下不生效）。 */
const WIN32_SAFE_KEYS = new Set([
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "USERPROFILE",
]);

/** 面向包管理器（pip/uv/npm/pnpm/yarn）的推荐 passthrough，供 provisioner 使用。 */
export const INSTALLER_ENV_PASSTHROUGH: readonly string[] = [
  "NPM_CONFIG_*",
  "PNPM_*",
  "YARN_*",
  "COREPACK_*",
  "PIP_*",
  "UV_*",
  "PYTHONPATH",
  "VIRTUAL_ENV",
];

export function buildChildEnv(
  spec: EnvSpec,
  hostEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  // 1. 基底
  const result: Record<string, string> = {};
  if ((spec.inherit ?? "safe") === "safe") {
    for (const [key, value] of Object.entries(hostEnv)) {
      if (value === undefined) continue;
      const safe =
        SAFE_KEYS.has(key) ||
        SAFE_PREFIXES.some((p) => key.startsWith(p)) ||
        (process.platform === "win32" && WIN32_SAFE_KEYS.has(key.toUpperCase()));
      if (safe) result[key] = value;
    }
  }
  // 2. passthrough（精确名或尾部 * 前缀通配，区分大小写）
  for (const pattern of spec.passthrough ?? []) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      for (const [key, value] of Object.entries(hostEnv)) {
        if (value !== undefined && key.startsWith(prefix)) result[key] = value;
      }
    } else {
      const value = hostEnv[pattern];
      if (value !== undefined) result[pattern] = value;
    }
  }
  // 3. 显式注入，优先级最高；undefined 删除
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}
