import type { Hono } from "hono";
import { getModelConfigStore } from "@clawbot/agent";
import { invalidateModelCache } from "@clawbot/agent/model-resolver";
import type { ModelConfigRow } from "@clawbot/agent";
import type { ModelConfigDto } from "@clawbot/shared";

function toDto(row: ModelConfigRow): ModelConfigDto {
  return {
    id: String(row.id),
    scope: row.scope,
    scope_key: row.scopeKey,
    purpose: row.purpose,
    template_id: String(row.templateId),
    template_name: row.templateName,
    provider: row.provider,
    model_id: row.modelId,
    template_enabled: row.templateEnabled,
    enabled: row.enabled,
    priority: row.priority,
  };
}

export function registerModelConfigRoutes(app: Hono) {
  const store = () => getModelConfigStore();

  // List all configs
  app.get("/api/model-configs", async (c) => {
    const configs = await store().listAllConfigs();
    return c.json({ data: configs.map(toDto) });
  });

  // Upsert a config
  app.put("/api/model-configs", async (c) => {
    const body = await c.req.json();

    // Validate required fields
    const { scope, scope_key, purpose, template_id, model_id } = body;
    if (!scope || !scope_key || !purpose || !template_id || !model_id) {
      return c.json(
        {
          error:
            "Missing required fields: scope, scope_key, purpose, template_id, model_id",
        },
        400,
      );
    }

    if (!["global", "account", "conversation"].includes(scope)) {
      return c.json({ error: "scope must be global, account, or conversation" }, 400);
    }

    if (!["chat", "extraction", "*"].includes(purpose)) {
      return c.json({ error: "purpose must be chat, extraction, or *" }, 400);
    }

    const templateId = BigInt(template_id);
    const template = await store().getTemplateById(templateId);
    if (!template) {
      return c.json({ error: "selected template not found" }, 400);
    }
    if (!template.modelIds.includes(model_id)) {
      return c.json({ error: "model_id must belong to the selected template" }, 400);
    }

    const row = await store().upsertConfig({
      scope,
      scopeKey: scope_key,
      purpose,
      templateId,
      modelId: model_id,
      enabled: body.enabled ?? true,
      priority: body.priority ?? 0,
    });

    invalidateModelCache(scope, scope_key);
    return c.json({ data: toDto(row) });
  });

  // Delete a config
  app.delete("/api/model-configs/:id", async (c) => {
    const id = BigInt(c.req.param("id"));
    const ok = await store().deleteConfig(id);
    if (!ok) {
      return c.json({ error: "not found" }, 404);
    }
    invalidateModelCache();
    return c.json({ success: true });
  });
}
