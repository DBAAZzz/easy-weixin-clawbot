import { useState } from "react";
import type { AccountStatusFilter, AccountSummary } from "@clawbot/shared";
import { fetchAccounts } from "../lib/api.js";
import { useAsyncResource } from "./use-async-resource.js";

export function useAccounts(options?: { status?: AccountStatusFilter }) {
  const [revision, setRevision] = useState(0);
  const status = options?.status ?? "all";
  const resource = useAsyncResource<AccountSummary[]>(
    () => fetchAccounts({ status }),
    [status, revision],
  );

  return {
    accounts: resource.data ?? [],
    loading: resource.loading,
    error: resource.error,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
