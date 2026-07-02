import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchUsageOverview } from "@/api/usage.js";
import { queryKeys } from "../lib/query-keys.js";

export function useUsageOverview(accountId?: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.usageOverview(accountId),
    queryFn: () => fetchUsageOverview(accountId),
  });

  return {
    overview: query.data ?? null,
    loading: query.isPending,
    error:
      query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    refresh() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.usageOverview(accountId) });
    },
  };
}
