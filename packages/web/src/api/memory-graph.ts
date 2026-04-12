import type { TapeGraphResponse } from "@clawbot/shared";
import { request } from "./core/client";
import { toQueryString } from "./core/query";

export function fetchTapeGraph(
  accountId: string,
  branch = "__global__",
): Promise<TapeGraphResponse> {
  return request<TapeGraphResponse>(`/api/tape/graph${toQueryString({ accountId, branch })}`);
}
