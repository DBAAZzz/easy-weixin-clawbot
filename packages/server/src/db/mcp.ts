import type {
  McpServerInfo,
  McpServerStatus,
  McpToolInfo,
  McpTransport,
} from "@clawbot/shared";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { getPrisma } from "./prisma.js";

export interface McpServerWriteInput {
  name: string;
  slug: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
}

export interface McpServerRuntimeConfig extends McpServerWriteInput {
  id: string;
  enabled: boolean;
  status: McpServerStatus;
  last_error: string | null;
  last_seen_at: string | null;
}

export interface DiscoveredMcpToolInput {
  remote_name: string;
  local_name: string;
  summary: string | null;
  input_schema: Record<string, unknown>;
}

export interface McpRuntimeToolBinding {
  id: string;
  server_id: string;
  server_name: string;
  server_slug: string;
  remote_name: string;
  local_name: string;
  summary: string | null;
  input_schema: Record<string, unknown>;
}

const MCP_SLUG_PATTERN = /^[a-z][a-z0-9_-]{1,20}$/;

function toIso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function parseStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function parseStringRecord(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function parseSchema(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toBigIntId(id: string): bigint {
  return BigInt(id);
}

function toServerInfo(row: {
  id: bigint;
  name: string;
  slug: string;
  transport: string;
  command: string;
  argsJson: Prisma.JsonValue;
  envJson: Prisma.JsonValue;
  cwd: string | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { tools: number };
}): McpServerInfo {
  return {
    id: row.id.toString(),
    name: row.name,
    slug: row.slug,
    transport: row.transport as McpTransport,
    command: row.command,
    args: parseStringArray(row.argsJson),
    env: parseStringRecord(row.envJson),
    cwd: row.cwd,
    enabled: row.enabled,
    status: row.status as McpServerStatus,
    last_error: row.lastError,
    last_seen_at: toIso(row.lastSeenAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    tool_count: row._count?.tools ?? 0,
  };
}

function toToolInfo(row: {
  id: bigint;
  serverId: bigint;
  remoteName: string;
  localName: string;
  summary: string | null;
  inputSchema: Prisma.JsonValue;
  enabled: boolean;
  lastSeenAt: Date | null;
  server: {
    name: string;
    slug: string;
  };
}): McpToolInfo {
  return {
    id: row.id.toString(),
    server_id: row.serverId.toString(),
    server_name: row.server.name,
    server_slug: row.server.slug,
    remote_name: row.remoteName,
    local_name: row.localName,
    summary: row.summary,
    input_schema: parseSchema(row.inputSchema),
    enabled: row.enabled,
    last_seen_at: toIso(row.lastSeenAt),
  };
}

function toRuntimeConfig(row: {
  id: bigint;
  name: string;
  slug: string;
  transport: string;
  command: string;
  argsJson: Prisma.JsonValue;
  envJson: Prisma.JsonValue;
  cwd: string | null;
  enabled: boolean;
  status: string;
  lastError: string | null;
  lastSeenAt: Date | null;
}): McpServerRuntimeConfig {
  return {
    id: row.id.toString(),
    name: row.name,
    slug: row.slug,
    transport: row.transport as McpTransport,
    command: row.command,
    args: parseStringArray(row.argsJson),
    env: parseStringRecord(row.envJson),
    cwd: row.cwd,
    enabled: row.enabled,
    status: row.status as McpServerStatus,
    last_error: row.lastError,
    last_seen_at: toIso(row.lastSeenAt),
  };
}

function sanitizeSegment(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+/, "")
    .replace(/[_-]+$/, "");

  return normalized || fallback;
}

export function validateMcpSlug(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!MCP_SLUG_PATTERN.test(normalized)) {
    throw new Error('slug must match /^[a-z][a-z0-9_-]{1,20}$/');
  }
  return normalized;
}

export function buildMcpLocalToolName(serverSlug: string, remoteName: string): string {
  const safeSlug = sanitizeSegment(serverSlug, "server").slice(0, 12);
  const safeRemote = sanitizeSegment(remoteName, "tool");
  const hash = createHash("sha1")
    .update(`${serverSlug}:${remoteName}`)
    .digest("hex")
    .slice(0, 6);
  const maxRemoteLength = Math.max(6, 49 - `mcp__${safeSlug}__`.length - 7);
  const trimmedRemote = safeRemote.slice(0, maxRemoteLength);
  return `mcp__${safeSlug}__${trimmedRemote}_${hash}`;
}

export async function listMcpServers(): Promise<McpServerInfo[]> {
  const rows = await getPrisma().mcpServer.findMany({
    include: { _count: { select: { tools: true } } },
    orderBy: [{ createdAt: "asc" }],
  });

  return rows.map(toServerInfo);
}

export async function getMcpServer(id: string): Promise<McpServerInfo | null> {
  const row = await getPrisma().mcpServer.findUnique({
    where: { id: toBigIntId(id) },
    include: { _count: { select: { tools: true } } },
  });

  return row ? toServerInfo(row) : null;
}

export async function getMcpServerConfig(id: string): Promise<McpServerRuntimeConfig | null> {
  const row = await getPrisma().mcpServer.findUnique({
    where: { id: toBigIntId(id) },
  });

  return row ? toRuntimeConfig(row) : null;
}

export async function listEnabledMcpServerConfigs(): Promise<McpServerRuntimeConfig[]> {
  const rows = await getPrisma().mcpServer.findMany({
    where: { enabled: true },
    orderBy: [{ createdAt: "asc" }],
  });

  return rows.map(toRuntimeConfig);
}

export async function createMcpServer(input: McpServerWriteInput): Promise<McpServerInfo> {
  const row = await getPrisma().mcpServer.create({
    data: {
      name: input.name,
      slug: validateMcpSlug(input.slug),
      transport: input.transport,
      command: input.command,
      argsJson: input.args,
      envJson: input.env,
      cwd: input.cwd,
    },
    include: { _count: { select: { tools: true } } },
  });

  return toServerInfo(row);
}

export async function updateMcpServer(
  id: string,
  input: Partial<McpServerWriteInput>,
): Promise<McpServerInfo> {
  const row = await getPrisma().mcpServer.update({
    where: { id: toBigIntId(id) },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: validateMcpSlug(input.slug) } : {}),
      ...(input.transport !== undefined ? { transport: input.transport } : {}),
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.args !== undefined ? { argsJson: input.args } : {}),
      ...(input.env !== undefined ? { envJson: input.env } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    },
    include: { _count: { select: { tools: true } } },
  });

  return toServerInfo(row);
}

export async function deleteMcpServer(id: string): Promise<void> {
  await getPrisma().mcpServer.delete({
    where: { id: toBigIntId(id) },
  });
}

export async function setMcpServerEnabled(id: string, enabled: boolean): Promise<McpServerInfo> {
  const row = await getPrisma().mcpServer.update({
    where: { id: toBigIntId(id) },
    data: { enabled },
    include: { _count: { select: { tools: true } } },
  });

  return toServerInfo(row);
}

export async function updateMcpServerConnectionState(
  id: string,
  input: {
    status: McpServerStatus;
    last_error: string | null;
    last_seen_at?: Date | null;
  },
): Promise<void> {
  await getPrisma().mcpServer.update({
    where: { id: toBigIntId(id) },
    data: {
      status: input.status,
      lastError: input.last_error,
      lastSeenAt: input.last_seen_at ?? undefined,
    },
  });
}

export async function listMcpTools(): Promise<McpToolInfo[]> {
  const rows = await getPrisma().mcpTool.findMany({
    include: {
      server: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
    orderBy: [{ localName: "asc" }],
  });

  return rows.map(toToolInfo);
}

export async function setMcpToolEnabled(id: string, enabled: boolean): Promise<McpToolInfo> {
  const row = await getPrisma().mcpTool.update({
    where: { id: toBigIntId(id) },
    data: { enabled },
    include: {
      server: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
  });

  return toToolInfo(row);
}

export async function syncMcpTools(
  serverId: string,
  tools: DiscoveredMcpToolInput[],
): Promise<void> {
  const prisma = getPrisma();
  const numericServerId = toBigIntId(serverId);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const tool of tools) {
      await tx.mcpTool.upsert({
        where: {
          serverId_remoteName: {
            serverId: numericServerId,
            remoteName: tool.remote_name,
          },
        },
        update: {
          localName: tool.local_name,
          summary: tool.summary,
          inputSchema: tool.input_schema as Prisma.InputJsonValue,
          lastSeenAt: now,
        },
        create: {
          serverId: numericServerId,
          remoteName: tool.remote_name,
          localName: tool.local_name,
          summary: tool.summary,
          inputSchema: tool.input_schema as Prisma.InputJsonValue,
          lastSeenAt: now,
        },
      });
    }

    await tx.mcpTool.deleteMany({
      where: {
        serverId: numericServerId,
        ...(tools.length > 0
          ? {
              remoteName: {
                notIn: tools.map((tool) => tool.remote_name),
              },
            }
          : {}),
      },
    });
  });
}

export async function listEnabledMcpBindings(
  serverIds: readonly string[],
): Promise<McpRuntimeToolBinding[]> {
  if (serverIds.length === 0) {
    return [];
  }

  const rows = await getPrisma().mcpTool.findMany({
    where: {
      enabled: true,
      serverId: {
        in: serverIds.map(toBigIntId),
      },
      server: {
        enabled: true,
      },
    },
    include: {
      server: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
    orderBy: [{ localName: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id.toString(),
    server_id: row.serverId.toString(),
    server_name: row.server.name,
    server_slug: row.server.slug,
    remote_name: row.remoteName,
    local_name: row.localName,
    summary: row.summary,
    input_schema: parseSchema(row.inputSchema),
  }));
}
