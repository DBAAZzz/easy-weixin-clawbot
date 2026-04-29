import type { Hono } from "hono";
import { getModelConfigStore } from "@clawbot/agent";
import { invalidateModelCache } from "@clawbot/agent/model-resolver";
import type { ModelProviderTemplateRow } from "@clawbot/agent";
import type {
  ModelProviderTemplateDto,
  ModelProviderTemplatePingDto,
} from "@clawbot/shared";

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

const OPENAI_COMPATIBLE_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  moonshot: "https://api.moonshot.cn/v1",
  kimi: "https://api.moonshot.cn/v1",
  xiaomi: "https://token-plan-cn.xiaomimimo.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  xai: "https://api.x.ai/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
};

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function joinEndpoint(baseUrl: string, path: string): string {
  return new URL(path, ensureTrailingSlash(baseUrl)).toString();
}

function resolvePingTarget(
  row: ModelProviderTemplateRow,
):
  | { endpoint: string; init: RequestInit }
  | { endpoint: string | null; message: string } {
  const provider = row.provider.trim().toLowerCase();
  const apiKey = row.apiKey?.trim() ?? "";

  let endpoint: string | null = null;
  let init: RequestInit | null = null;

  if (provider === "anthropic") {
    const baseUrl = row.baseUrl?.trim() || "https://api.anthropic.com";
    endpoint = joinEndpoint(baseUrl, "v1/models");
    init = {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  } else if (provider === "kimi-coding" || provider === "xiaomi-anthropic") {
    const baseUrl =
      row.baseUrl?.trim() ||
      (provider === "xiaomi-anthropic"
        ? "https://token-plan-cn.xiaomimimo.com/anthropic"
        : "https://api.kimi.com/coding/v1");
    endpoint = joinEndpoint(baseUrl, "models");
    init = {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  } else if (provider === "google") {
    const baseUrl = row.baseUrl?.trim() || "https://generativelanguage.googleapis.com";
    const url = new URL(joinEndpoint(baseUrl, "v1beta/models"));
    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }
    endpoint = url.toString();
    init = { method: "GET" };
  } else if (provider === "azure-openai") {
    if (!row.baseUrl?.trim()) {
      return { endpoint: null, message: "Azure OpenAI 需要 Base URL" };
    }
    const url = new URL(joinEndpoint(row.baseUrl.trim(), "openai/models"));
    url.searchParams.set("api-version", "2024-10-21");
    endpoint = url.toString();
    init = {
      method: "GET",
      headers: {
        "api-key": apiKey,
      },
    };
  } else {
    const baseUrl =
      row.baseUrl?.trim() || OPENAI_COMPATIBLE_BASE_URLS[provider] || null;
    if (!baseUrl) {
      return { endpoint: null, message: "未配置可探测的 Base URL" };
    }
    endpoint = joinEndpoint(baseUrl, "models");
    init = {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    };
  }

  if (!apiKey) {
    return { endpoint, message: "未配置 API Key" };
  }

  return { endpoint, init };
}

function extractModelCount(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) {
    return record.data.length;
  }
  if (Array.isArray(record.models)) {
    return record.models.length;
  }
  return null;
}

function createPingResult(
  row: ModelProviderTemplateRow,
  input: Omit<ModelProviderTemplatePingDto, "template_id" | "provider" | "checked_at">,
): ModelProviderTemplatePingDto {
  return {
    template_id: String(row.id),
    provider: row.provider,
    checked_at: new Date().toISOString(),
    ...input,
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

  app.post("/api/model-provider-templates/:id/ping", async (c) => {
    const id = BigInt(c.req.param("id"));
    const row = await store().getTemplateById(id);
    if (!row) {
      return c.json({ error: "not found" }, 404);
    }

    const target = resolvePingTarget(row);
    if ("message" in target) {
      return c.json({
        data: createPingResult(row, {
          reachable: false,
          status_code: null,
          latency_ms: null,
          endpoint: target.endpoint,
          message: target.message,
          model_count: null,
        }),
      });
    }

    const startedAt = Date.now();
    try {
      const response = await fetch(target.endpoint, {
        ...target.init,
        signal: AbortSignal.timeout(8_000),
      });
      const payload = await response
        .json()
        .catch(() => null);
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        return c.json({
          data: createPingResult(row, {
            reachable: false,
            status_code: response.status,
            latency_ms: latencyMs,
            endpoint: target.endpoint,
            message: `连接失败 (${response.status})`,
            model_count: extractModelCount(payload),
          }),
        });
      }

      return c.json({
        data: createPingResult(row, {
          reachable: true,
          status_code: response.status,
          latency_ms: latencyMs,
          endpoint: target.endpoint,
          message: "连接正常",
          model_count: extractModelCount(payload),
        }),
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message =
        error instanceof Error && error.name === "TimeoutError"
          ? "连接超时"
          : error instanceof Error
            ? error.message
            : "连接失败";
      return c.json({
        data: createPingResult(row, {
          reachable: false,
          status_code: null,
          latency_ms: latencyMs,
          endpoint: target.endpoint,
          message,
          model_count: null,
        }),
      });
    }
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
