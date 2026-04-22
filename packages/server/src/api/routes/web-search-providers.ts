import type { Hono } from "hono";
import type { WebSearchProviderDto } from "@clawbot/shared";
import {
  webSearchProviderStore,
  type WebSearchProviderRow,
  type WebSearchProviderStore,
} from "../../web-tools/provider-store.js";
import {
  isWebSearchProviderType,
  type WebSearchProviderType,
} from "../../web-tools/provider-types.js";

function toDto(row: WebSearchProviderRow): WebSearchProviderDto {
  return {
    id: String(row.id),
    provider_type: row.providerType,
    api_key_set: row.apiKeySet,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function parseProviderType(value: string): WebSearchProviderType | null {
  const normalized = value.trim().toLowerCase();
  return isWebSearchProviderType(normalized) ? normalized : null;
}

function parseOptionalEnabled(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function registerWebSearchProviderRoutes(
  app: Hono,
  store: WebSearchProviderStore = webSearchProviderStore,
) {
  app.get("/api/web-search/providers", async (c) => {
    const rows = await store.list();
    return c.json({ data: rows.map(toDto) });
  });

  app.post("/api/web-search/providers", async (c) => {
    const body = await c.req.json().catch(() => null);
    const providerType = parseProviderType(String(body?.provider_type ?? ""));
    const apiKey = typeof body?.api_key === "string" ? body.api_key.trim() : "";

    if (!providerType) {
      return c.json({ error: "provider_type must be brave or tavily" }, 400);
    }
    if (!apiKey) {
      return c.json({ error: "api_key is required" }, 400);
    }
    if (await store.get(providerType)) {
      return c.json({ error: "provider already exists" }, 409);
    }

    const row = await store.create({
      providerType,
      apiKey,
      enabled: parseOptionalEnabled(body?.enabled) ?? true,
    });

    return c.json({ data: toDto(row) }, 201);
  });

  app.patch("/api/web-search/providers/:providerType", async (c) => {
    const providerType = parseProviderType(c.req.param("providerType"));
    const body = await c.req.json().catch(() => null);
    const apiKey = typeof body?.api_key === "string" ? body.api_key.trim() : undefined;
    const enabled = parseOptionalEnabled(body?.enabled);

    if (!providerType) {
      return c.json({ error: "provider_type must be brave or tavily" }, 400);
    }
    if (apiKey !== undefined && apiKey.length === 0) {
      return c.json({ error: "api_key cannot be empty" }, 400);
    }
    if (apiKey === undefined && enabled === undefined) {
      return c.json({ error: "at least one of api_key or enabled is required" }, 400);
    }
    if (!(await store.get(providerType))) {
      return c.json({ error: "provider not found" }, 404);
    }

    const row = await store.update(providerType, {
      apiKey,
      enabled,
    });
    return c.json({ data: toDto(row) });
  });

  app.post("/api/web-search/providers/:providerType/enable", async (c) => {
    const providerType = parseProviderType(c.req.param("providerType"));
    if (!providerType) {
      return c.json({ error: "provider_type must be brave or tavily" }, 400);
    }
    if (!(await store.get(providerType))) {
      return c.json({ error: "provider not found" }, 404);
    }

    const row = await store.enable(providerType);
    return c.json({ data: toDto(row) });
  });

  app.post("/api/web-search/providers/:providerType/disable", async (c) => {
    const providerType = parseProviderType(c.req.param("providerType"));
    if (!providerType) {
      return c.json({ error: "provider_type must be brave or tavily" }, 400);
    }
    if (!(await store.get(providerType))) {
      return c.json({ error: "provider not found" }, 404);
    }

    const row = await store.disable(providerType);
    return c.json({ data: toDto(row) });
  });
}