import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMessages } from "@/api/conversation.js";
import { queryKeys } from "../lib/query-keys.js";

export function useMessages(accountId?: string, conversationId?: string) {
  const queryClient = useQueryClient();
  const enabled = Boolean(accountId && conversationId);

  const { data, isPending, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useInfiniteQuery({
      queryKey: queryKeys.messages(accountId ?? "", conversationId ?? ""),
      queryFn: ({ pageParam }) =>
        fetchMessages(accountId!, conversationId!, {
          limit: 20,
          before: pageParam,
        }),
      initialPageParam: undefined as number | undefined,
      getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_cursor : undefined),
      enabled,
    });

  // pages[0] = newest batch, pages[1] = older batch, etc.
  // Reverse so messages are chronological (oldest first).
  const messages = data
    ? data.pages
        .slice()
        .reverse()
        .flatMap((page) => page.data)
    : [];

  return {
    messages,
    loading: enabled && isPending,
    loadingMore: isFetchingNextPage,
    hasMore: hasNextPage ?? false,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    loadMore() {
      if (hasNextPage && !isFetchingNextPage) {
        void fetchNextPage();
      }
    },
    refresh() {
      if (accountId && conversationId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.messages(accountId, conversationId),
        });
      }
    },
  };
}
