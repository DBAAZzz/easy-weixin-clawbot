import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ObservabilityWindow } from "@clawbot/shared";
import {
  fetchObservabilityOverview,
  fetchObservabilityTrace,
  fetchObservabilityTraces,
} from "@/api/observability.js";
import { queryKeys } from "../lib/query-keys.js";

export interface ObservabilityFilters {
  window: ObservabilityWindow;
  flag?: string;
  status?: "ok" | "error";
  query?: string;
}

export function useObservability(filters: ObservabilityFilters) {
  const queryClient = useQueryClient();

  const overviewQuery = useQuery({
    queryKey: queryKeys.observabilityOverview(filters.window),
    queryFn: () => fetchObservabilityOverview(filters.window),
  });

  const tracesQuery = useInfiniteQuery({
    queryKey: queryKeys.observabilityTraces({
      window: filters.window,
      flag: filters.flag,
      status: filters.status,
      query: filters.query,
    }),
    queryFn: ({ pageParam }) =>
      fetchObservabilityTraces({
        window: filters.window,
        limit: 20,
        cursor: pageParam,
        flag: filters.flag,
        status: filters.status,
        query: filters.query?.trim() || undefined,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => (lastPage.has_more ? lastPage.next_cursor : undefined),
  });

  const rawError = overviewQuery.error || tracesQuery.error;

  return {
    overview: overviewQuery.data ?? null,
    traces: tracesQuery.data?.pages.flatMap((p) => p.data) ?? [],
    loadingOverview: overviewQuery.isPending,
    loadingTraces: tracesQuery.isPending,
    loadingMore: tracesQuery.isFetchingNextPage,
    hasMore: tracesQuery.hasNextPage ?? false,
    error: rawError instanceof Error ? rawError.message : rawError ? String(rawError) : null,
    loadMore() {
      if (tracesQuery.hasNextPage && !tracesQuery.isFetchingNextPage) {
        void tracesQuery.fetchNextPage();
      }
    },
    refresh() {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.observabilityOverview(filters.window),
      });
      void queryClient.invalidateQueries({
        queryKey: ["observabilityTraces"],
      });
    },
  };
}

export function useObservabilityTrace(traceId?: string) {
  const queryClient = useQueryClient();
  const enabled = Boolean(traceId);
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.observabilityTrace(traceId ?? ""),
    queryFn: () => fetchObservabilityTrace(traceId!),
    enabled,
  });

  return {
    trace: data ?? null,
    loading: enabled && isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh() {
      if (traceId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.observabilityTrace(traceId),
        });
      }
    },
  };
}
