import { useState } from "react";
import type { ConversationRow } from "@clawbot/shared";
import { fetchConversations } from "../lib/api.js";
import { useAsyncResource } from "./use-async-resource.js";

export function useConversations(accountId?: string) {
  const [revision, setRevision] = useState(0);
  const resource = useAsyncResource<ConversationRow[]>(
    accountId ? () => fetchConversations(accountId) : null,
    [accountId, revision]
  );

  return {
    conversations: resource.data ?? [],
    loading: resource.loading,
    error: resource.error,
    refresh() {
      setRevision((value) => value + 1);
    },
  };
}
