import type { AppSettingsDto } from "@clawbot/shared";
import { request } from "./core/client.js";

export type UpdateAppSettingsPayload = Partial<{
  normal_rate: number;
  rsshub_base_url: string | null;
  rsshub_auth_type: "none" | "basic" | "bearer";
  rsshub_username: string | null;
  rsshub_password: string | null;
  rsshub_bearer_token: string | null;
  rss_request_timeout_ms: number;
  asset_storage_provider: "local" | "s3-compatible";
  asset_local_base_dir: string | null;
  asset_s3_name: string | null;
  asset_s3_endpoint: string | null;
  asset_s3_region: string | null;
  asset_s3_bucket: string | null;
  asset_s3_access_key_id: string | null;
  asset_s3_secret_access_key: string | null;
  asset_s3_public_base_url: string | null;
}>;

export function fetchAppSettings(): Promise<AppSettingsDto> {
  return request<AppSettingsDto>("/api/settings");
}

export function updateAppSettings(payload: UpdateAppSettingsPayload): Promise<AppSettingsDto> {
  return request<AppSettingsDto>("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
