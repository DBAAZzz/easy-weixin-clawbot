import type { AppSettingsDto } from "@clawbot/shared";
import { request } from "./core/client.js";

export function fetchAppSettings(): Promise<AppSettingsDto> {
  return request<AppSettingsDto>("/api/settings");
}

export function updateAppSettings(
  payload: Partial<{
    normal_rate: number;
    rsshub_base_url: string | null;
    rsshub_auth_type: "none" | "basic" | "bearer";
    rsshub_username: string | null;
    rsshub_password: string | null;
    rsshub_bearer_token: string | null;
    rss_request_timeout_ms: number;
  }>,
): Promise<AppSettingsDto> {
  return request<AppSettingsDto>("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
