import type { Hono } from "hono";
import type { McpTransport } from "@clawbot/shared";
import type { McpManager } from "../../mcp/manager.js";

const STANDARD_MCP_SLUG_MAX_LENGTH = 21;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((item) => typeof item === "string"),
  );
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid request body");
  }
  return body;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }

  return value as Record<string, unknown>;
}

function stripToAscii(value: string) {
  return value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
}

function trimSlugTail(value: string) {
  return value.replace(/[-_]+$/g, "");
}

function deriveMcpSlug(value: string) {
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
  return trimSlugTail(withPrefix).slice(0, STANDARD_MCP_SLUG_MAX_LENGTH) || "server";
}

function parseStandardDocument(body: Record<string, unknown>) {
  if (!("mcpServers" in body)) {
    return null;
  }

  const servers = requireObject(body.mcpServers, "mcpServers must be an object");
  const entries = Object.entries(servers);

  if (entries.length !== 1) {
    throw new Error("mcpServers must contain exactly one server");
  }

  const [rawKey, rawConfig] = entries[0];
  const key = rawKey.trim();
  if (!key) {
    throw new Error("mcp server key is required");
  }

  const config = requireObject(rawConfig, "mcp server config must be an object");
  const transport =
    config.transport === undefined
      ? "stdio"
      : (requireString(config.transport, "transport") as McpTransport);

  if (transport !== "stdio") {
    throw new Error("only stdio transport is supported");
  }

  const cwdValue = config.cwd;
  if (cwdValue !== undefined && cwdValue !== null && typeof cwdValue !== "string") {
    throw new Error("cwd must be string or null");
  }

  return {
    name: key,
    slug: deriveMcpSlug(key),
    transport: "stdio" as const,
    command: requireString(config.command, "command"),
    args:
      config.args === undefined
        ? []
        : isStringArray(config.args)
          ? config.args
          : (() => {
              throw new Error("args must be a string array");
            })(),
    env:
      config.env === undefined
        ? {}
        : isStringRecord(config.env)
          ? config.env
          : (() => {
              throw new Error("env must be an object of string values");
            })(),
    cwd: typeof cwdValue === "string" ? cwdValue.trim() || null : null,
  } as const;
}

function parseCreatePayload(body: Record<string, unknown>) {
  const standard = parseStandardDocument(body);
  if (standard) {
    return standard;
  }

  return {
    name: requireString(body.name, "name"),
    slug: requireString(body.slug, "slug"),
    transport:
      (body.transport === undefined
        ? "stdio"
        : requireString(body.transport, "transport")) as McpTransport,
    command: requireString(body.command, "command"),
    args: body.args === undefined ? [] : isStringArray(body.args) ? body.args : (() => {
      throw new Error("args must be a string array");
    })(),
    env: body.env === undefined ? {} : isStringRecord(body.env) ? body.env : (() => {
      throw new Error("env must be an object of string values");
    })(),
    cwd:
      body.cwd === undefined
        ? null
        : body.cwd === null
          ? null
          : typeof body.cwd === "string"
            ? body.cwd.trim() || null
            : (() => {
                throw new Error("cwd must be string or null");
              })(),
  } as const;
}

function parseUpdatePayload(body: Record<string, unknown>) {
  const standard = parseStandardDocument(body);
  if (standard) {
    return standard;
  }

  const input: Record<string, unknown> = {};

  if ("name" in body) {
    input.name = requireString(body.name, "name");
  }
  if ("slug" in body) {
    input.slug = requireString(body.slug, "slug");
  }
  if ("transport" in body) {
    input.transport = requireString(body.transport, "transport");
  }
  if ("command" in body) {
    input.command = requireString(body.command, "command");
  }
  if ("args" in body) {
    if (!isStringArray(body.args)) {
      throw new Error("args must be a string array");
    }
    input.args = body.args;
  }
  if ("env" in body) {
    if (!isStringRecord(body.env)) {
      throw new Error("env must be an object of string values");
    }
    input.env = body.env;
  }
  if ("cwd" in body) {
    if (body.cwd !== null && typeof body.cwd !== "string") {
      throw new Error("cwd must be string or null");
    }
    input.cwd = body.cwd === null ? null : body.cwd?.trim() || null;
  }

  return input;
}

export function registerMcpRoutes(app: Hono, manager: McpManager) {
  app.get("/api/mcp/servers", async (c) => {
    return c.json({ data: await manager.listServers() });
  });

  app.post("/api/mcp/servers", async (c) => {
    try {
      const payload = parseCreatePayload(await readJsonBody(c.req.raw));
      return c.json({ data: await manager.createServer(payload) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.get("/api/mcp/servers/:id", async (c) => {
    const server = await manager.getServer(c.req.param("id"));
    if (!server) {
      return c.json({ error: "MCP server not found" }, 404);
    }
    return c.json({ data: server });
  });

  app.patch("/api/mcp/servers/:id", async (c) => {
    try {
      const payload = parseUpdatePayload(await readJsonBody(c.req.raw));
      return c.json({ data: await manager.updateServer(c.req.param("id"), payload) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.delete("/api/mcp/servers/:id", async (c) => {
    try {
      await manager.deleteServer(c.req.param("id"));
      return c.json({ data: { id: c.req.param("id") } });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/mcp/servers/:id/refresh", async (c) => {
    try {
      return c.json({ data: await manager.refreshServer(c.req.param("id")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/mcp/servers/:id/enable", async (c) => {
    try {
      return c.json({ data: await manager.enableServer(c.req.param("id")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/mcp/servers/:id/disable", async (c) => {
    try {
      return c.json({ data: await manager.disableServer(c.req.param("id")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.get("/api/mcp/tools", async (c) => {
    return c.json({ data: await manager.listTools() });
  });

  app.post("/api/mcp/tools/:id/enable", async (c) => {
    try {
      return c.json({ data: await manager.enableTool(c.req.param("id")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });

  app.post("/api/mcp/tools/:id/disable", async (c) => {
    try {
      return c.json({ data: await manager.disableTool(c.req.param("id")) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid request" }, 400);
    }
  });
}
