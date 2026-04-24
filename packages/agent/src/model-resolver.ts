/**
 * ModelResolver — resolves which LLM model to use for a given request context.
 *
 * Resolution chain (first match wins):
 *   1. conversation-level config  (scope="conversation", scopeKey="accountId:conversationId")
 *   2. account-level config       (scope="account", scopeKey=accountId)
 *   3. global config              (scope="global", scopeKey="*")
 */

import type { LanguageModel } from "ai";
import { createLanguageModel } from "./llm/provider-factory.js";
import type { ModelMeta } from "./llm/types.js";
import {
  getModelConfigStore,
  type ModelConfigRow,
  type ModelPurpose,
} from "./ports/model-config-store.js";

// ── Types ─────────────────────────────────────────────────────────────

export interface ResolvedModel {
  model: LanguageModel;
  modelId: string;
  meta: ModelMeta;
}

export const LLM_PROVIDER_NOT_CONFIGURED_CODE = "LLM_PROVIDER_NOT_CONFIGURED";
export const LLM_PROVIDER_NOT_CONFIGURED_MESSAGE =
  "LLM provider is not configured. Configure a provider template and usage config in Web admin before using the Agent.";
export const LLM_PROVIDER_NOT_CONFIGURED_USER_MESSAGE =
  "尚未配置 LLM Provider。请先在后台创建 Provider 模板并添加使用配置。";

export class LLMProviderNotConfiguredError extends Error {
  readonly code = LLM_PROVIDER_NOT_CONFIGURED_CODE;
  readonly userMessage = LLM_PROVIDER_NOT_CONFIGURED_USER_MESSAGE;

  constructor(
    readonly accountId: string,
    readonly conversationId: string,
    readonly purpose: ModelPurpose,
  ) {
    super(LLM_PROVIDER_NOT_CONFIGURED_MESSAGE);
    this.name = "LLMProviderNotConfiguredError";
  }
}

export function isLLMProviderNotConfiguredError(
  error: unknown,
): error is LLMProviderNotConfiguredError {
  return (
    error instanceof LLMProviderNotConfiguredError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === LLM_PROVIDER_NOT_CONFIGURED_CODE)
  );
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
 * Build a LanguageModel + metadata from provider + modelId + optional baseUrl.
 * Replaces pi-ai's getModel() with the AI SDK provider factory.
 */
export function buildModelFromConfig(
  provider: string,
  modelId: string,
  options?: { apiKey?: string; baseUrl?: string | null },
): { model: LanguageModel; meta: ModelMeta } {
  return createLanguageModel(provider, modelId, {
    apiKey: options?.apiKey ?? undefined,
    baseUrl: options?.baseUrl,
  });
}

// ── Resolution ────────────────────────────────────────────────────────

function matchPurpose(rowPurpose: string, wanted: ModelPurpose): boolean {
  return rowPurpose === wanted || rowPurpose === "*";
}

function rowSupportsModel(row: ModelConfigRow): boolean {
  return row.modelIds.includes(row.modelId);
}

function throwProviderNotConfigured(
  accountId: string,
  conversationId: string,
  purpose: ModelPurpose,
): never {
  console.warn(
    "[model-resolver] LLM provider is not configured",
    { accountId, conversationId, purpose, code: LLM_PROVIDER_NOT_CONFIGURED_CODE },
  );

  throw new LLMProviderNotConfiguredError(accountId, conversationId, purpose);
}

/**
 * Resolve a model for a given request context.
 */
export async function resolveModel(
  accountId: string,
  conversationId: string,
  purpose: ModelPurpose,
): Promise<ResolvedModel> {
  const configured = await resolveConfiguredModel(accountId, conversationId, purpose);
  if (configured) {
    return configured;
  }

  throwProviderNotConfigured(accountId, conversationId, purpose);
}

/**
 * Resolve a model only from configured scope rules.
 * Returns null when no conversation/account/global config matches.
 */
export async function resolveConfiguredModel(
  accountId: string,
  conversationId: string,
  purpose: ModelPurpose,
): Promise<ResolvedModel | null> {
  const lookups: Array<[string, string]> = [
    ["conversation", `${accountId}:${conversationId}`],
    ["account", accountId],
    ["global", "*"],
  ];

  for (const [scope, scopeKey] of lookups) {
    const rows = await fetchRows(scope, scopeKey);
    for (const row of rows) {
      if (!matchPurpose(row.purpose, purpose)) {
        continue;
      }

      if (!row.enabled || !row.templateEnabled || !rowSupportsModel(row)) {
        continue;
      }

      const { model, meta } = buildModelFromConfig(
        row.provider,
        row.modelId,
        { apiKey: row.apiKey ?? undefined, baseUrl: row.baseUrl },
      );
      return {
        model,
        modelId: row.modelId,
        meta,
      };
    }
  }

  return null;
}
