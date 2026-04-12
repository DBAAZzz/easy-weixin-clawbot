import type {
  ObservabilityOverview,
  ObservabilityTraceDetail,
  ObservabilityTraceSummary,
  ObservabilityWindow,
  PaginatedResponse,
} from "@clawbot/shared";
import { request, requestPaginated } from "./core/client";
import { toQueryString } from "./core/query";

export function fetchObservabilityOverview(
  window: ObservabilityWindow,
): Promise<ObservabilityOverview> {
  return request<ObservabilityOverview>(`/api/observability/overview${toQueryString({ window })}`);
}

export function fetchObservabilityTraces(options: {
  window: ObservabilityWindow;
  limit?: number;
  cursor?: number;
  flag?: string;
  status?: "ok" | "error";
  query?: string;
}): Promise<PaginatedResponse<ObservabilityTraceSummary>> {
  return requestPaginated<ObservabilityTraceSummary>(
    `/api/observability/traces${toQueryString({
      window: options.window,
      limit: options.limit,
      cursor: options.cursor,
      flag: options.flag,
      status: options.status,
      query: options.query,
    })}`,
  );
}

export function fetchObservabilityTrace(traceId: string): Promise<ObservabilityTraceDetail> {
  return request<ObservabilityTraceDetail>(
    `/api/observability/traces/${encodeURIComponent(traceId)}`,
  );
}
