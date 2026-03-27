import { useState } from "react";
import type { AccountSummary } from "@clawbot/shared";
import { fetchAccounts } from "../lib/api.js";
import { useAsyncResource } from "./use-async-resource.js";

export function useAccounts() {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource<AccountSummary[]>(() => fetchAccounts(), [revision]);

  return {
    accounts: resource.data ?? [],
    loading: resource.loading,
    error: resource.error,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
