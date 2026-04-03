import { useEffect, useState } from "react";
import type {
  ObservabilityOverview,
  ObservabilityTraceDetail,
  ObservabilityTraceSummary,
  ObservabilityWindow,
} from "@clawbot/shared";
import {
  fetchObservabilityOverview,
  fetchObservabilityTrace,
  fetchObservabilityTraces,
} from "../lib/api.js";

export interface ObservabilityFilters {
  window: ObservabilityWindow;
  flag?: string;
  status?: "ok" | "error";
  query?: string;
}

export function useObservability(
  filters: ObservabilityFilters,
) {
  const [overview, setOverview] = useState<ObservabilityOverview | null>(null);
  const [traces, setTraces] = useState<ObservabilityTraceSummary[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [loadingTraces, setLoadingTraces] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingOverview(true);
    setError(null);

    void fetchObservabilityOverview(filters.window)
      .then((result) => {
        if (cancelled) return;
        setOverview(result);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingOverview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.window, revision]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTraces(true);
    setError(null);

    void fetchObservabilityTraces({
      window: filters.window,
      limit: 20,
      flag: filters.flag,
      status: filters.status,
      query: filters.query?.trim() || undefined,
    })
      .then((page) => {
        if (cancelled) return;
        setTraces(page.data);
        setHasMore(page.has_more);
        setNextCursor(page.next_cursor);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingTraces(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filters.flag, filters.query, filters.status, filters.window, revision]);

  async function loadMore() {
    if (!hasMore || !nextCursor || loadingMore) return;

    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchObservabilityTraces({
        window: filters.window,
        limit: 20,
        cursor: nextCursor,
        flag: filters.flag,
        status: filters.status,
        query: filters.query?.trim() || undefined,
      });
      setTraces((current) => [...current, ...page.data]);
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    overview,
    traces,
    loadingOverview,
    loadingTraces,
    loadingMore,
    hasMore,
    error,
    loadMore,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}

export function useObservabilityTrace(traceId?: string) {
  const [trace, setTrace] = useState<ObservabilityTraceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!traceId) {
      setTrace(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchObservabilityTrace(traceId)
      .then((result) => {
        if (cancelled) return;
        setTrace(result);
      })
      .catch((reason) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [traceId, revision]);

  return {
    trace,
    loading,
    error,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
