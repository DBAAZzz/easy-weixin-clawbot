import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WebSearchProviderDto } from "@clawbot/shared";
import {
  createWebSearchProvider,
  disableWebSearchProvider,
  enableWebSearchProvider,
  fetchWebSearchProviders,
  updateWebSearchProvider,
} from "@/api/web-search.js";
import { queryKeys } from "../lib/query-keys.js";

export function useWebSearchProviders(enabled = true) {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.webSearchProviders,
    queryFn: fetchWebSearchProviders,
    enabled,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.webSearchProviders });
  }

  return {
    providers: data ?? ([] as WebSearchProviderDto[]),
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    async create(payload: {
      provider_type: WebSearchProviderDto["provider_type"];
      api_key: string;
      enabled?: boolean;
    }) {
      const result = await createWebSearchProvider(payload);
      await refresh();
      return result;
    },
    async update(
      providerType: WebSearchProviderDto["provider_type"],
      payload: {
        api_key?: string;
        enabled?: boolean;
      },
    ) {
      const result = await updateWebSearchProvider(providerType, payload);
      await refresh();
      return result;
    },
    async enable(providerType: WebSearchProviderDto["provider_type"]) {
      const result = await enableWebSearchProvider(providerType);
      await refresh();
      return result;
    },
    async disable(providerType: WebSearchProviderDto["provider_type"]) {
      const result = await disableWebSearchProvider(providerType);
      await refresh();
      return result;
    },
    refresh,
  };
}
