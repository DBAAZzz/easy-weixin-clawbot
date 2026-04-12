import type { AccountStatusFilter, AccountSummary, ConversationRow } from "@clawbot/shared";
import { request } from "./core/client";
import { toQueryString } from "./core/query";

export function fetchAccounts(options?: {
  status?: AccountStatusFilter;
}): Promise<AccountSummary[]> {
  const suffix = toQueryString({
    status: options?.status && options.status !== "all" ? options.status : undefined,
  });
  return request<AccountSummary[]>(`/api/accounts${suffix}`);
}

export function updateAccountAlias(
  accountId: string,
  alias: string | null,
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/accounts/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    body: JSON.stringify({ alias }),
  });
}

export function fetchConversations(accountId: string): Promise<ConversationRow[]> {
  return request<ConversationRow[]>(`/api/accounts/${encodeURIComponent(accountId)}/conversations`);
}
