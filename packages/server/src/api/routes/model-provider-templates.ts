import type { Hono } from "hono";
import { getModelConfigStore } from "@clawbot/agent";
import { invalidateModelCache } from "@clawbot/agent/model-resolver";
import type { ModelProviderTemplateRow } from "@clawbot/agent";
import type { ModelProviderTemplateDto } from "@clawbot/shared";

function normalizeModelIds(values: unknown): string[] {
  const normalized = Array.isArray(values)
    ? values.map((value) => String(value).trim()).filter(Boolean)
    : [];
  return [...new Set(normalized)];
}

function toDto(row: ModelProviderTemplateRow): ModelProviderTemplateDto {
  return {
    id: String(row.id),
    name: row.name,
    provider: row.provider,
    model_ids: row.modelIds,
    api_key_set: row.apiKey !== null,
    base_url: row.baseUrl,
    enabled: row.enabled,
    usage_count: row.usageCount,
  };
}

export function registerModelProviderTemplateRoutes(app: Hono) {
  const store = () => getModelConfigStore();

  app.get("/api/model-provider-templates", async (c) => {
    const templates = await store().listTemplates();
    return c.json({ data: templates.map(toDto) });
  });

  app.post("/api/model-provider-templates", async (c) => {
    const body = await c.req.json();
    const modelIds = normalizeModelIds(body.model_ids);

    if (!String(body.name ?? "").trim() || !String(body.provider ?? "").trim()) {
      return c.json({ error: "name and provider are required" }, 400);
    }
    if (modelIds.length === 0) {
      return c.json({ error: "model_ids must contain at least one value" }, 400);
    }

    const row = await store().createTemplate({
      name: String(body.name).trim(),
      provider: String(body.provider).trim(),
      modelIds,
      apiKey: body.api_key ? String(body.api_key) : null,
      baseUrl: body.base_url ? String(body.base_url) : null,
      enabled: body.enabled ?? true,
    });

    invalidateModelCache();
    return c.json({ data: toDto(row) });
  });

  app.patch("/api/model-provider-templates/:id", async (c) => {
    const body = await c.req.json();
    const id = BigInt(c.req.param("id"));
    const modelIds = normalizeModelIds(body.model_ids);
    const clearApiKey = body.clear_api_key === true;
    const hasApiKey = Object.prototype.hasOwnProperty.call(body, "api_key");

    if (!String(body.name ?? "").trim() || !String(body.provider ?? "").trim()) {
      return c.json({ error: "name and provider are required" }, 400);
    }
    if (modelIds.length === 0) {
      return c.json({ error: "model_ids must contain at least one value" }, 400);
    }
    if (clearApiKey && body.api_key) {
      return c.json({ error: "api_key and clear_api_key cannot be used together" }, 400);
    }
    if (!(await store().getTemplateById(id))) {
      return c.json({ error: "not found" }, 404);
    }

    const row = await store().updateTemplate({
      id,
      name: String(body.name).trim(),
      provider: String(body.provider).trim(),
      modelIds,
      apiKey: hasApiKey ? (body.api_key ? String(body.api_key) : null) : undefined,
      clearApiKey,
      baseUrl: body.base_url ? String(body.base_url) : null,
      enabled: body.enabled ?? true,
    });

    invalidateModelCache();
    return c.json({ data: toDto(row) });
  });

  app.delete("/api/model-provider-templates/:id", async (c) => {
    const id = BigInt(c.req.param("id"));
    const usageCount = await store().countConfigsForTemplate(id);
    if (usageCount > 0) {
      return c.json({ error: "template is still referenced by model configs" }, 409);
    }

    const ok = await store().deleteTemplate(id);
    if (!ok) {
      return c.json({ error: "not found" }, 404);
    }

    invalidateModelCache();
    return c.json({ success: true });
  });
}
