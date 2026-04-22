export const WEB_SEARCH_PROVIDER_TYPES = ["brave", "tavily"] as const;

export type WebSearchProviderType = (typeof WEB_SEARCH_PROVIDER_TYPES)[number];

export function isWebSearchProviderType(value: string): value is WebSearchProviderType {
  return WEB_SEARCH_PROVIDER_TYPES.includes(value as WebSearchProviderType);
}