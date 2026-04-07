import { useState } from "react";
import type { TapeGraphResponse } from "@clawbot/shared";
import { fetchTapeGraph } from "../lib/api.js";
import { useAsyncResource } from "./use-async-resource.js";

export function useTapeGraph(accountId?: string, branch = "__global__") {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource<TapeGraphResponse>(
    accountId ? () => fetchTapeGraph(accountId, branch) : null,
    [accountId, branch, revision],
  );

  return {
    graph: resource.data,
    loading: resource.loading,
    error: resource.error,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
