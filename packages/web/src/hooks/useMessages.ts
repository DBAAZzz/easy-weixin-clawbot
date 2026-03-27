import { useEffect, useState } from "react";
import type { MessageRow } from "@clawbot/shared";
import { fetchMessages } from "../lib/api.js";

export function useMessages(accountId?: string, conversationId?: string) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!accountId || !conversationId) {
      setMessages([]);
      setLoading(false);
      setError(null);
      setHasMore(false);
      setNextCursor(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchMessages(accountId, conversationId, { limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setMessages(page.data);
        setHasMore(page.has_more);
        setNextCursor(page.next_cursor);
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
  }, [accountId, conversationId, revision]);

  async function loadMore() {
    if (!accountId || !conversationId || !hasMore || !nextCursor || loadingMore) return;

    setLoadingMore(true);
    setError(null);

    try {
      const page = await fetchMessages(accountId, conversationId, {
        limit: 50,
        before: nextCursor,
      });

      setMessages((current) => [...page.data, ...current]);
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    messages,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
