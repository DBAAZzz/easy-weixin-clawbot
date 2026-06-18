// mcp-cn.com 注册表返回的 connections 字段是损坏的非法 JSON 字符串（key/value 无引号），
// 且 @mcp_hub_org/cli 对此没有容错，会在 `connections.filter()` 处崩溃。
// 这里在「起动前」把 `@mcp_hub_org/cli run <qualifiedName>` 形式的配置解析为真实命令，
// 绕开坏掉的 CLI，直接 spawn 底层 MCP server。

const HUB_CLI_PKG = "@mcp_hub_org/cli";
const REGISTRY_ENDPOINT = process.env.MCP_REGISTRY_ENDPOINT ?? "https://www.mcp-cn.com/api";

const PREFERRED_RUNNERS = ["npx", "uvx", "docker"];

interface StdioLaunchSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface LooseConnection {
  type: string;
  config: { command: string; args: string[] };
}

/**
 * 检测配置是否为 `@mcp_hub_org/cli ... run <qualifiedName>`，是则返回 qualifiedName。
 * 不限定 command（npx / pnpm dlx / bunx 等都可能），只要 args 里含 hub CLI 包即可。
 */
export function detectHubRun(_command: string, args: readonly string[]): string | null {
  const cliIndex = args.findIndex(
    (arg) => arg === HUB_CLI_PKG || arg.startsWith(`${HUB_CLI_PKG}@`),
  );
  if (cliIndex === -1) {
    return null;
  }

  const runIndex = args.indexOf("run", cliIndex + 1);
  if (runIndex === -1) {
    return null;
  }

  const qualifiedName = args[runIndex + 1];
  return qualifiedName?.trim() || null;
}

/**
 * 容错解析 connections：优先标准 JSON 数组；失败则用正则从损坏字符串里抽取 stdio 配置。
 */
function parseConnections(raw: unknown): LooseConnection[] {
  if (Array.isArray(raw)) {
    return raw as LooseConnection[];
  }
  if (typeof raw !== "string") {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as LooseConnection[];
    }
  } catch {
    // 落入下方的宽松解析
  }

  const connections: LooseConnection[] = [];
  const pattern =
    /type:\s*([a-z]+)\s*,\s*config:\s*\{\s*command:\s*([^,}\]]+?)\s*,\s*args:\s*\[([^\]]*)\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    connections.push({
      type: match[1],
      config: {
        command: match[2].trim(),
        args: match[3]
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      },
    });
  }
  return connections;
}

/** 镜像 hub CLI 的选取逻辑：优先 npx/uvx/docker，否则取第一个 stdio。 */
function pickStdioConnection(connections: LooseConnection[]): StdioLaunchSpec | null {
  const stdio = connections.filter((conn) => conn.type === "stdio");
  if (stdio.length === 0) {
    return null;
  }

  for (const runner of PREFERRED_RUNNERS) {
    const found = stdio.find((conn) => conn.config?.command?.startsWith(runner));
    if (found) {
      return { command: found.config.command, args: found.config.args ?? [] };
    }
  }

  const first = stdio[0];
  return { command: first.config.command, args: first.config.args ?? [] };
}

async function resolveHubServer(qualifiedName: string): Promise<StdioLaunchSpec> {
  const url = `${REGISTRY_ENDPOINT}/servers/get_details?qualifiedName=${encodeURIComponent(qualifiedName)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MCP registry responded ${response.status} for ${qualifiedName}`);
  }

  const payload = (await response.json()) as { data?: { connections?: unknown } };
  const spec = pickStdioConnection(parseConnections(payload?.data?.connections));
  if (!spec) {
    throw new Error(`No stdio connection found for ${qualifiedName}`);
  }
  return spec;
}

/**
 * 返回真正用于 spawn 的 command/args/env。
 * 若不是 hub CLI 形式则原样返回；是则解析为底层真实命令（用户自定义 env 覆盖解析得到的 env）。
 */
export async function resolveLaunchSpec(server: {
  command: string;
  args: string[];
  env: Record<string, string>;
}): Promise<{ command: string; args: string[]; env: Record<string, string>; rewrittenFrom?: string }> {
  const qualifiedName = detectHubRun(server.command, server.args);
  if (!qualifiedName) {
    return { command: server.command, args: server.args, env: server.env };
  }

  const resolved = await resolveHubServer(qualifiedName);
  return {
    command: resolved.command,
    args: resolved.args,
    env: { ...(resolved.env ?? {}), ...server.env },
    rewrittenFrom: qualifiedName,
  };
}
