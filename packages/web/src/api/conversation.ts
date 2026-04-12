import type { MessageRow, PaginatedResponse } from "@clawbot/shared";
import { requestPaginated } from "./core/client";
import { toQueryString } from "./core/query";

export function fetchMessages(
  accountId: string,
  conversationId: string,
  options?: { before?: number; limit?: number },
): Promise<PaginatedResponse<MessageRow>> {
  const suffix = toQueryString({
    limit: options?.limit,
    before: options?.before,
  });

  return requestPaginated<MessageRow>(
    `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
  );
}
