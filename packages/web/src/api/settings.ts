import type { AppSettingsDto } from "@clawbot/shared";
import { request } from "./core/client.js";

export function fetchAppSettings(): Promise<AppSettingsDto> {
  return request<AppSettingsDto>("/api/settings");
}

export function updateAppSettings(payload: { normal_rate: number }): Promise<AppSettingsDto> {
  return request<AppSettingsDto>("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
