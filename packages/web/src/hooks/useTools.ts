import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTools } from "@/api/tools.js";
import { queryKeys } from "../lib/query-keys.js";

export function useTools() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.tools,
    queryFn: fetchTools,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
  }

  return {
    tools: data ?? [],
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh: invalidate,
  };
}
