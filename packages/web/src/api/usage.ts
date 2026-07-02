import type { UsageOverview } from "@clawbot/shared";
import { request } from "./core/client";
import { toQueryString } from "./core/query";

export function fetchUsageOverview(accountId?: string): Promise<UsageOverview> {
  return request<UsageOverview>(
    `/api/usage/overview${toQueryString({ window: "30d", accountId })}`,
  );
}
