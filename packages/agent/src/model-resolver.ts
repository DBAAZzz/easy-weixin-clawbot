/**
 * ModelResolver — resolves which LLM model to use for a given request context.
 *
 * Resolution chain (first match wins):
 *   1. conversation-level config  (scope="conversation", scopeKey="accountId:conversationId")
 *   2. account-level config       (scope="account", scopeKey=accountId)
 *   3. global config              (scope="global", scopeKey="*")
 *   4. env-var default            (set at startup via setDefaultModel)
 */

import { getModel, type Model } from "@mariozechner/pi-ai";
import {
  getModelConfigStore,
  type ModelConfigRow,
  type ModelPurpose,
} from "./ports/model-config-store.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface ResolvedModel {
  model: Model<any>;
  modelId: string;
  apiKey: string | undefined;
}

// ── Default model (env-var fallback) ──────────────────────────────────

let defaultModel: ResolvedModel | null = null;

export function setDefaultModel(resolved: ResolvedModel): void {
  defaultModel = resolved;
}

export function getDefaultModel(): ResolvedModel {
  if (!defaultModel)
    throw new Error("Default model not set — call setDefaultModel() at startup");
  return defaultModel;
}

// ── In-memory cache ───────────────────────────────────────────────────

interface CacheEntry {
  rows: ModelConfigRow[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

/** Invalidate cache entries. Call after API writes. */
export function invalidateModelCache(
  scope?: string,
  scopeKey?: string,
): void {
  if (scope && scopeKey) {
    cache.delete(`${scope}:${scopeKey}`);
  } else {
    cache.clear();
  }
}

async function fetchRows(
  scope: string,
  scopeKey: string,
): Promise<ModelConfigRow[]> {
  const key = `${scope}:${scopeKey}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rows;
  }
  const store = getModelConfigStore();
  const rows = await store.findByScope(scope as any, scopeKey);
  cache.set(key, { rows, fetchedAt: Date.now() });
  return rows;
}

// ── Model construction ────────────────────────────────────────────────

/**
 * Build a Model object from provider + modelId + optional baseUrl.
 * Consolidates the moonshot/kimi special-case logic.
 */
export function buildModelFromConfig(
  provider: string,
  modelId: string,
  baseUrl?: string | null,
): Model<any> {
  if (provider === "moonshot" || provider === "kimi") {
    const url =
      baseUrl ??
      (provider === "kimi"
        ? "https://api.kimi.ai/v1"
        : "https://api.moonshot.cn/v1");
    return {
      id: modelId,
      name: `Moonshot ${modelId}`,
      api: "openai-completions" as const,
      provider: "moonshot",
      baseUrl: url,
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    };
  }

  const model = (getModel as any)(provider, modelId);
  if (!model) {
    throw new Error(
      `[model-resolver] Unknown provider/model: provider="${provider}" model="${modelId}". ` +
        `Check model config — the combination is not supported by pi-ai.`,
    );
  }
  return model;
}

// ── Resolution ────────────────────────────────────────────────────────

function matchPurpose(rowPurpose: string, wanted: ModelPurpose): boolean {
  return rowPurpose === wanted || rowPurpose === "*";
}

function rowSupportsModel(row: ModelConfigRow): boolean {
  return row.modelIds.includes(row.modelId);
}

/**
 * Resolve a model for a given request context.
 */
export async function resolveModel(
  accountId: string,
  conversationId: string,
  purpose: ModelPurpose,
): Promise<ResolvedModel> {
  const lookups: Array<[string, string]> = [
    ["conversation", `${accountId}:${conversationId}`],
    ["account", accountId],
    ["global", "*"],
  ];

  for (const [scope, scopeKey] of lookups) {
    const rows = await fetchRows(scope, scopeKey);
    const match = rows.find((r) => matchPurpose(r.purpose, purpose));
    if (match && match.templateEnabled && rowSupportsModel(match)) {
      const model = buildModelFromConfig(
        match.provider,
        match.modelId,
        match.baseUrl,
      );
      return {
        model,
        modelId: match.modelId,
        apiKey: match.apiKey ?? undefined,
      };
    }
  }

  return getDefaultModel();
}
