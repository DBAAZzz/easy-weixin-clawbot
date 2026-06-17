const PROVIDER_BRAND_KEYS = [
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "moonshot",
  "kimi",
  "xiaomi",
  "xiaomi-anthropic",
  "openrouter",
  "azure-openai",
] as const;

export type ProviderBrandKey = (typeof PROVIDER_BRAND_KEYS)[number];

export function getProviderBrandKey(provider: string): ProviderBrandKey | null {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_BRAND_KEYS.includes(normalized as ProviderBrandKey)
    ? (normalized as ProviderBrandKey)
    : null;
}
