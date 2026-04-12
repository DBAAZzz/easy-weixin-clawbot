import type { HealthStatus } from "@clawbot/shared";
import { request } from "./core/client";

export function fetchHealth(): Promise<HealthStatus> {
  return request<HealthStatus>("/api/health");
}
