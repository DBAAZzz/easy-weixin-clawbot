import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchHealth } from "@/api/health.js";
import { queryKeys } from "../lib/query-keys.js";

export function useHealth() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    staleTime: 60_000,
  });

  return {
    health: data ?? null,
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.health });
    },
  };
}
