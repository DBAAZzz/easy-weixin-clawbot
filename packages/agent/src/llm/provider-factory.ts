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
import { createDeepSeek } from "@ai-sdk/deepseek";
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
  deepseek: { contextWindow: 128_000, maxOutputTokens: 8192 },
  openrouter: { contextWindow: 128_000, maxOutputTokens: 4096 },
  xai: { contextWindow: 128_000, maxOutputTokens: 4096 },
  groq: { contextWindow: 128_000, maxOutputTokens: 4096 },
  mistral: { contextWindow: 128_000, maxOutputTokens: 4096 },
};

const FALLBACK_META: ModelMeta = { contextWindow: 128_000, maxOutputTokens: 4096 };

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

function buildProviderModel(
  provider: string,
  modelId: string,
  options?: { apiKey?: string; baseUrl?: string | null },
): LanguageModel {
  const apiKey = options?.apiKey ?? undefined;

  switch (provider) {
    case "anthropic":
      return createAnthropic({ ...(apiKey ? { apiKey } : {}) })(modelId);

    case "openai":
      return createOpenAI({ ...(apiKey ? { apiKey } : {}) })(modelId);

    case "google":
      return createGoogleGenerativeAI({ ...(apiKey ? { apiKey } : {}) })(modelId);

    case "moonshot":
    case "kimi": {
      const baseURL =
        options?.baseUrl ??
        (provider === "kimi"
          ? "https://api.kimi.ai/v1"
          : "https://api.moonshot.cn/v1");
      return createMoonshotAI({ baseURL, ...(apiKey ? { apiKey } : {}) })(modelId);
    }

    case "kimi-coding":
      return createMoonshotAI({
        baseURL: options?.baseUrl ?? "https://api.kimi.ai/v1",
        ...(apiKey ? { apiKey } : {}),
      })(modelId);

    case "deepseek":
      return createDeepSeek({
        baseURL: options?.baseUrl ?? "https://api.deepseek.com/v1",
        ...(apiKey ? { apiKey } : {}),
      })(modelId);

    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: options?.baseUrl ?? "https://openrouter.ai/api/v1",
        ...(apiKey ? { apiKey } : {}),
      })(modelId);

    case "xai":
      return createXai({
        ...(options?.baseUrl ? { baseURL: options.baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      })(modelId);

    case "groq":
      return createGroq({
        ...(options?.baseUrl ? { baseURL: options.baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      })(modelId);

    case "mistral":
      return createMistral({
        ...(options?.baseUrl ? { baseURL: options.baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      })(modelId);

    default:
      // Unknown provider with custom baseUrl → OpenAI-compatible
      if (options?.baseUrl) {
        return createOpenAICompatible({
          name: provider,
          baseURL: options.baseUrl,
          ...(apiKey ? { apiKey } : {}),
        })(modelId);
      }
      throw new Error(
        `[provider-factory] Unknown provider "${provider}" with no baseUrl. ` +
          `Supported: anthropic, openai, google, moonshot, kimi, kimi-coding, deepseek, openrouter, xai, groq, mistral.`,
      );
  }
}
