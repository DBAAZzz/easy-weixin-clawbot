import { useEffect, useState } from "react";

export function useAsyncResource<T>(
  factory: (() => Promise<T>) | null,
  deps: ReadonlyArray<unknown>
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(factory));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!factory) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void factory()
      .then((result) => {
        if (cancelled) return;
        setData(result);
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
  }, deps);

  return {
    data,
    loading,
    error,
    setData,
  };
}
