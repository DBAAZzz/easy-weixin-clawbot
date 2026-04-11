import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountStatusFilter } from "@clawbot/shared";
import { fetchAccounts } from "../lib/api.js";
import { queryKeys } from "../lib/query-keys.js";

export function useAccounts(options?: { status?: AccountStatusFilter }) {
  const queryClient = useQueryClient();
  const status = options?.status ?? "all";
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.accounts(status),
    queryFn: () => fetchAccounts({ status }),
    staleTime: 5 * 60_000,
  });

  return {
    accounts: data ?? [],
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh() {
      void queryClient.invalidateQueries({ queryKey: queryKeys.accounts(status) });
    },
  };
}
