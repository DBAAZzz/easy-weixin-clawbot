import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchConversations } from "@/api/accounts.js";
import { queryKeys } from "../lib/query-keys.js";

export function useConversations(accountId?: string) {
  const queryClient = useQueryClient();
  const enabled = Boolean(accountId);
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.conversations(accountId ?? ""),
    queryFn: () => fetchConversations(accountId!),
    enabled,
    staleTime: 2 * 60_000,
  });

  return {
    conversations: data ?? [],
    loading: enabled && isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh() {
      if (accountId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(accountId) });
      }
    },
  };
}
