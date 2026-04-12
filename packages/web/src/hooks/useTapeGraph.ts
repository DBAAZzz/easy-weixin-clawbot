import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTapeGraph } from "@/api/memory-graph.js";
import { queryKeys } from "../lib/query-keys.js";

export function useTapeGraph(accountId?: string, branch = "__global__") {
  const queryClient = useQueryClient();
  const enabled = Boolean(accountId);
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.tapeGraph(accountId ?? "", branch),
    queryFn: () => fetchTapeGraph(accountId!, branch),
    enabled,
  });

  return {
    graph: data,
    loading: enabled && isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh() {
      if (accountId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.tapeGraph(accountId, branch),
        });
      }
    },
  };
}
