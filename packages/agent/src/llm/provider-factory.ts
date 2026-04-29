/**
 * Provider factory — creates AI SDK LanguageModel instances from provider + modelId.
 *
 * Replaces pi-ai's `getModel()` global registry.
 */

import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMoonshotAI } from "@ai-sdk/moonshotai";
import { createXai } from "@ai-sdk/xai";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import type { ModelMeta } from "./types.js";

// ── Default metadata per provider ──────────────────────────────────

const PROVIDER_DEFAULTS: Record<string, ModelMeta> = {
  anthropic: { contextWindow: 200_000, maxOutputTokens: 8192 },
  openai: { contextWindow: 128_000, maxOutputTokens: 16384 },
  google: { contextWindow: 1_000_000, maxOutputTokens: 8192 },
  moonshot: { contextWindow: 128_000, maxOutputTokens: 4096 },
  kimi: { contextWindow: 128_000, maxOutputTokens: 4096 },
  "kimi-coding": { contextWindow: 128_000, maxOutputTokens: 4096 },
  xiaomi: { contextWindow: 128_000, maxOutputTokens: 4096 },
  "xiaomi-anthropic": { contextWindow: 128_000, maxOutputTokens: 4096 },
  deepseek: { contextWindow: 1_000_000, maxOutputTokens: 384_000, supportsImageInput: false },
  openrouter: { contextWindow: 128_000, maxOutputTokens: 4096 },
  xai: { contextWindow: 128_000, maxOutputTokens: 4096 },
  groq: { contextWindow: 128_000, maxOutputTokens: 4096 },
  mistral: { contextWindow: 128_000, maxOutputTokens: 4096 },
};

const FALLBACK_META: ModelMeta = { contextWindow: 128_000, maxOutputTokens: 4096 };
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MOONSHOT_DEFAULT_BASE_URL = "https://api.moonshot.cn/v1";
const KIMI_CODING_DEFAULT_BASE_URL = "https://api.kimi.com/coding/v1";
const XIAOMI_DEFAULT_BASE_URL = "https://token-plan-cn.xiaomimimo.com/v1";
const XIAOMI_ANTHROPIC_DEFAULT_BASE_URL = "https://token-plan-cn.xiaomimimo.com/anthropic";
const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com/v1";
const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const XAI_DEFAULT_BASE_URL = "https://api.x.ai/v1";
const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const MISTRAL_DEFAULT_BASE_URL = "https://api.mistral.ai/v1";

const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: OPENAI_DEFAULT_BASE_URL,
  moonshot: MOONSHOT_DEFAULT_BASE_URL,
  kimi: MOONSHOT_DEFAULT_BASE_URL,
  "kimi-coding": KIMI_CODING_DEFAULT_BASE_URL,
  xiaomi: XIAOMI_DEFAULT_BASE_URL,
  "xiaomi-anthropic": XIAOMI_ANTHROPIC_DEFAULT_BASE_URL,
  deepseek: DEEPSEEK_DEFAULT_BASE_URL,
  openrouter: OPENROUTER_DEFAULT_BASE_URL,
  xai: XAI_DEFAULT_BASE_URL,
  groq: GROQ_DEFAULT_BASE_URL,
  mistral: MISTRAL_DEFAULT_BASE_URL,
};

interface ProviderBuildContext {
  provider: string;
  modelId: string;
  apiKey: string;
  baseURL?: string;
}

type ProviderBuilder = (context: ProviderBuildContext) => LanguageModel;

function normalizeXiaomiModelId(modelId: string): string {
  return modelId.trim().toLowerCase();
}

function requireBaseURL(provider: string, baseURL: string | undefined): string {
  if (!baseURL) {
    throw new Error(`[provider-factory] Provider "${provider}" requires a baseUrl.`);
  }
  return baseURL;
}

// ── Public API ─────────────────────────────────────────────────────

export interface CreateModelResult {
  model: LanguageModel;
  meta: ModelMeta;
}

/**
 * Create a LanguageModel + metadata from provider name and modelId.
 * API key is baked into the model via the provider factory.
 */
export function createLanguageModel(
  provider: string,
  modelId: string,
  options?: {
    apiKey?: string;
    baseUrl?: string | null;
  },
): CreateModelResult {
  const model = buildProviderModel(provider, modelId, options);
  const meta = PROVIDER_DEFAULTS[provider] ?? FALLBACK_META;
  return { model, meta };
}

// ── Internal ───────────────────────────────────────────────────────

const PROVIDER_BUILDERS: Record<string, ProviderBuilder> = {
  anthropic: ({ modelId, apiKey, baseURL }) =>
    createAnthropic({
      ...(baseURL ? { baseURL } : {}),
      apiKey,
    })(modelId),

  openai: ({ modelId, apiKey, baseURL }) =>
    createOpenAI({
      baseURL,
      apiKey,
    })(modelId),

  google: ({ modelId, apiKey }) =>
    createGoogleGenerativeAI({ apiKey })(modelId),

  moonshot: ({ modelId, apiKey, baseURL }) =>
    createMoonshotAI({
      baseURL,
      apiKey,
    })(modelId),

  kimi: ({ modelId, apiKey, baseURL }) =>
    createMoonshotAI({
      baseURL,
      apiKey,
    })(modelId),

  "kimi-coding": ({ modelId, apiKey, baseURL }) =>
    createAnthropic({
      baseURL,
      apiKey,
    })(modelId),

  xiaomi: ({ modelId, apiKey, baseURL }) =>
    createOpenAICompatible({
      name: "xiaomi",
      baseURL: requireBaseURL("xiaomi", baseURL),
      apiKey,
    })(normalizeXiaomiModelId(modelId)),

  "xiaomi-anthropic": ({ modelId, apiKey, baseURL }) =>
    createAnthropic({
      name: "xiaomi-anthropic",
      baseURL,
      apiKey,
    })(normalizeXiaomiModelId(modelId)),

  // The official DeepSeek provider drops historical reasoning before the last user
  // message, which breaks DeepSeek thinking-mode tool-call validation.
  deepseek: ({ modelId, apiKey, baseURL }) =>
    createOpenAICompatible({
      name: "deepseek",
      baseURL: requireBaseURL("deepseek", baseURL),
      apiKey,
    })(modelId),

  openrouter: ({ modelId, apiKey, baseURL }) =>
    createOpenAICompatible({
      name: "openrouter",
      baseURL: requireBaseURL("openrouter", baseURL),
      apiKey,
    })(modelId),

  xai: ({ modelId, apiKey, baseURL }) =>
    createXai({
      ...(baseURL ? { baseURL } : {}),
      apiKey,
    })(modelId),

  groq: ({ modelId, apiKey, baseURL }) =>
    createGroq({
      ...(baseURL ? { baseURL } : {}),
      apiKey,
    })(modelId),

  mistral: ({ modelId, apiKey, baseURL }) =>
    createMistral({
      ...(baseURL ? { baseURL } : {}),
      apiKey,
    })(modelId),
};

function resolveBaseURL(provider: string, explicitBaseUrl?: string | null): string | undefined {
  return explicitBaseUrl?.trim() || PROVIDER_DEFAULT_BASE_URLS[provider];
}

function buildProviderModel(
  provider: string,
  modelId: string,
  options?: { apiKey?: string; baseUrl?: string | null },
): LanguageModel {
  const apiKey = options?.apiKey?.trim() ?? "";
  const baseURL = resolveBaseURL(provider, options?.baseUrl);
  const context: ProviderBuildContext = { provider, modelId, apiKey, baseURL };
  const builder = PROVIDER_BUILDERS[provider];

  if (builder) {
    return builder(context);
  }

  // Unknown provider with custom baseUrl → OpenAI-compatible
  if (baseURL) {
    return createOpenAICompatible({
      name: provider,
      baseURL,
      apiKey,
    })(modelId);
  }

  throw new Error(
    `[provider-factory] Unknown provider "${provider}" with no baseUrl. ` +
      `Supported: ${Object.keys(PROVIDER_BUILDERS).join(", ")}.`,
  );
}
