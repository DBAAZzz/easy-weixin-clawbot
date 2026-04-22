import type { WebSearchProviderDto } from "@clawbot/shared";
import { request } from "./core/client.js";

export function fetchWebSearchProviders(): Promise<WebSearchProviderDto[]> {
  return request<WebSearchProviderDto[]>("/api/web-search/providers");
}

export function createWebSearchProvider(payload: {
  provider_type: WebSearchProviderDto["provider_type"];
  api_key: string;
  enabled?: boolean;
}): Promise<WebSearchProviderDto> {
  return request<WebSearchProviderDto>("/api/web-search/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateWebSearchProvider(
  providerType: WebSearchProviderDto["provider_type"],
  payload: {
    api_key?: string;
    enabled?: boolean;
  },
): Promise<WebSearchProviderDto> {
  return request<WebSearchProviderDto>(
    `/api/web-search/providers/${encodeURIComponent(providerType)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export function enableWebSearchProvider(
  providerType: WebSearchProviderDto["provider_type"],
): Promise<WebSearchProviderDto> {
  return request<WebSearchProviderDto>(
    `/api/web-search/providers/${encodeURIComponent(providerType)}/enable`,
    {
      method: "POST",
      body: "{}",
    },
  );
}

export function disableWebSearchProvider(
  providerType: WebSearchProviderDto["provider_type"],
): Promise<WebSearchProviderDto> {
  return request<WebSearchProviderDto>(
    `/api/web-search/providers/${encodeURIComponent(providerType)}/disable`,
    {
      method: "POST",
      body: "{}",
    },
  );
}
