/**
 * Provider factory — creates AI SDK LanguageModel instances from provider + modelId.
 *
 * Replaces pi-ai's `getModel()` global registry.
 */

import {
  APICallError,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import { llmRetriesTotal } from "@clawbot/observability";
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
  deepseek: {
    contextWindow: 1_000_000,
    maxOutputTokens: 384_000,
    supportsImageInput: false,
    requiresReasonedToolHistory: true,
  },
  openrouter: { contextWindow: 128_000, maxOutputTokens: 4096 },
  xai: { contextWindow: 128_000, maxOutputTokens: 4096 },
  groq: { contextWindow: 128_000, maxOutputTokens: 4096 },
  mistral: { contextWindow: 128_000, maxOutputTokens: 4096 },
};

const MODEL_CAPABILITIES: Record<string, Partial<ModelMeta>> = {
  "deepseek:deepseek-chat": { supportsImageInput: false },
  "deepseek:deepseek-reasoner": { supportsImageInput: false },
  "deepseek:deepseek-v4-flash": { supportsImageInput: false },

  "openai:gpt-4.1": { supportsImageInput: true },
  "openai:gpt-4.1-mini": { supportsImageInput: true },
  "openai:gpt-4o": { supportsImageInput: true },
  "openai:gpt-4o-mini": { supportsImageInput: true },
  "openai:gpt-5": { supportsImageInput: true },
  "openai:gpt-5-mini": { supportsImageInput: true },

  "google:gemini-2.5-flash": { supportsImageInput: true },
  "google:gemini-2.5-flash-lite": { supportsImageInput: true },
  "google:gemini-2.0-flash": { supportsImageInput: true },
  "google:gemini-1.5-flash": { supportsImageInput: true },
  "google:gemini-1.5-pro": { supportsImageInput: true },

  "anthropic:claude-3-5-haiku-latest": { supportsImageInput: true },
  "anthropic:claude-3-5-sonnet-latest": { supportsImageInput: true },
  "anthropic:claude-3-7-sonnet-latest": { supportsImageInput: true },
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

function normalizeGoogleBaseURL(baseURL: string | undefined): string | undefined {
  if (!baseURL) {
    return undefined;
  }
  const trimmed = baseURL.replace(/\/+$/, "");
  if (/\/v1(?:beta)?$/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v1beta`;
}

// ── Retry observability ────────────────────────────────────────────

/**
 * AI SDK 在 `generateText`/`generateObject` 里对每次模型调用做重试（指数退避，
 * 仅限 429/408/5xx/网络等可重试错误）。重试发生在 `doGenerate` 之外，因此每次
 * 重试都会重新调用被包裹模型的 `doGenerate` —— 中间件的 `wrapGenerate` 也就会
 * 被逐次调用。我们在这里捕获可重试错误、记一次 `llmRetriesTotal` 后原样抛回，
 * 让 SDK 继续它的退避逻辑。这样原本静默的重试在指标里就可见了。
 *
 * 注意：计数的是「可重试失败」，包含重试预算耗尽时的最后一次失败 —— 即
 * 「命中可重试错误的次数」，而非「成功挽回的次数」。
 */
function recordRetryableFailure(provider: string, error: unknown): void {
  if (APICallError.isInstance(error) && error.isRetryable) {
    const status = String(error.statusCode ?? 0);
    llmRetriesTotal.inc({ provider, status });
    console.warn(`[llm-retry] provider=${provider} status=${status} ${error.message}`);
  }
}

function createRetryObservabilityMiddleware(provider: string): LanguageModelMiddleware {
  return {
    specificationVersion: "v3",
    wrapGenerate: async ({ doGenerate }) => {
      try {
        return await doGenerate();
      } catch (error) {
        recordRetryableFailure(provider, error);
        throw error;
      }
    },
    wrapStream: async ({ doStream }) => {
      try {
        return await doStream();
      } catch (error) {
        recordRetryableFailure(provider, error);
        throw error;
      }
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────

export interface CreateModelResult {
  model: LanguageModel;
  meta: ModelMeta;
}

/**
 * Create a LanguageModel + metadata from provider name and modelId.
 * API key is baked into the model via the provider factory.
 *
 * The returned model is wrapped with retry-observability middleware, so every
 * `generateText`/`generateObject` call site (runner, vision, title, tape,
 * heartbeat) emits `llmRetriesTotal` on retryable failures for free.
 */
export function createLanguageModel(
  provider: string,
  modelId: string,
  options?: {
    apiKey?: string;
    baseUrl?: string | null;
  },
): CreateModelResult {
  const rawModel = buildProviderModel(provider, modelId, options);
  const model = wrapLanguageModel({
    model: rawModel as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: createRetryObservabilityMiddleware(provider),
  });
  const providerMeta = PROVIDER_DEFAULTS[provider] ?? FALLBACK_META;
  const modelMeta = MODEL_CAPABILITIES[`${provider}:${modelId}`] ?? {};
  const meta: ModelMeta = { ...providerMeta, ...modelMeta };
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

  google: ({ modelId, apiKey, baseURL }) =>
    createGoogleGenerativeAI({
      ...(baseURL ? { baseURL: normalizeGoogleBaseURL(baseURL) } : {}),
      apiKey,
    })(modelId),

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
