import type { McpServerInfo } from "@clawbot/shared";

export interface McpServerInput {
  name: string;
  slug: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
}

export interface StandardMcpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string | null;
  transport?: "stdio";
}

export interface McpServerJsonDocument {
  mcpServers: Record<string, StandardMcpServerConfig>;
}

export type McpServerRequestPayload = McpServerInput | McpServerJsonDocument;

export const TAPD_MCP_JSON_EXAMPLE = JSON.stringify(
  {
    mcpServers: {
      "mcp-server-tapd": {
        command: "uvx",
        args: ["mcp-server-tapd"],
        env: {
          TAPD_ACCESS_TOKEN: "",
          TAPD_API_USER: "",
          TAPD_API_PASSWORD: "",
          TAPD_API_BASE_URL: "https://api.tapd.cn",
          TAPD_BASE_URL: "https://www.tapd.cn",
          BOT_URL: "",
        },
      },
    },
  },
  null,
  2,
);

function stripToAscii(value: string) {
  return value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
}

function trimSlugTail(value: string) {
  return value.replace(/[-_]+$/g, "");
}

function deriveMcpSlug(value: string): string {
  const normalized = trimSlugTail(
    stripToAscii(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+/g, ""),
  );

  if (!normalized) {
    return "server";
  }

  const withPrefix = /^[a-z]/.test(normalized) ? normalized : `mcp-${normalized}`;
  return trimSlugTail(withPrefix).slice(0, 21) || "server";
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }

  return value.trim();
}

function parseStringArray(value: unknown, message: string): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(message);
  }

  return value.map((item) => item.trim());
}

function parseStringRecord(value: unknown, message: string): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  const object = requireObject(value, message);
  if (Object.values(object).some((item) => typeof item !== "string")) {
    throw new Error(message);
  }

  return object as Record<string, string>;
}

function parseStandardServerConfig(key: string, value: unknown): McpServerInput {
  const config = requireObject(value, "mcpServers 下的 server 配置必须是对象。");
  const transport =
    config.transport === undefined
      ? "stdio"
      : requireString(config.transport, "transport 必须是字符串。");

  if (transport !== "stdio") {
    throw new Error("当前仅支持 stdio transport。");
  }

  const cwdValue = config.cwd;
  if (cwdValue !== undefined && cwdValue !== null && typeof cwdValue !== "string") {
    throw new Error("cwd 必须是字符串或 null。");
  }

  return {
    name: key,
    slug: deriveMcpSlug(key),
    transport: "stdio",
    command: requireString(config.command, "command 不能为空。"),
    args: parseStringArray(config.args, "args 必须是字符串数组。"),
    env: parseStringRecord(config.env, "env 必须是字符串字典。"),
    cwd: typeof cwdValue === "string" ? cwdValue.trim() || null : null,
  };
}

function buildDocumentEntryFromInput(input: McpServerInput): StandardMcpServerConfig {
  const config: StandardMcpServerConfig = {
    command: input.command,
  };

  if (input.args.length > 0) {
    config.args = [...input.args];
  }

  if (Object.keys(input.env).length > 0) {
    config.env = { ...input.env };
  }

  if (input.cwd) {
    config.cwd = input.cwd;
  }

  return config;
}

export function parseMcpServerJsonText(text: string): {
  document: McpServerJsonDocument;
  key: string;
  input: McpServerInput;
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("请输入合法的 JSON。");
  }

  const document = requireObject(parsed, "JSON 根节点必须是对象。");
  const serverMap = requireObject(document.mcpServers, "必须包含 mcpServers 对象。");
  const entries = Object.entries(serverMap);

  if (entries.length !== 1) {
    throw new Error("一次只能导入 1 个 MCP server。");
  }

  const [rawKey, value] = entries[0];
  const key = rawKey.trim();
  if (!key) {
    throw new Error("mcpServers 的 key 不能为空。");
  }

  const input = parseStandardServerConfig(key, value);

  return {
    document: {
      mcpServers: {
        [key]: buildDocumentEntryFromInput(input),
      },
    },
    key,
    input,
  };
}

export function buildMcpServerJsonDocument(
  server: Pick<McpServerInfo, "name" | "command" | "args" | "env" | "cwd">,
): McpServerJsonDocument {
  return {
    mcpServers: {
      [server.name]: buildDocumentEntryFromInput({
        name: server.name,
        slug: deriveMcpSlug(server.name),
        transport: "stdio",
        command: server.command,
        args: [...server.args],
        env: { ...server.env },
        cwd: server.cwd,
      }),
    },
  };
}

export function stringifyMcpServerJsonDocument(
  server: Pick<McpServerInfo, "name" | "command" | "args" | "env" | "cwd">,
): string {
  return JSON.stringify(buildMcpServerJsonDocument(server), null, 2);
}
