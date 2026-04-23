import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppSettingsDto } from "@clawbot/shared";
import { fetchAppSettings, updateAppSettings } from "@/api/settings.js";
import { queryKeys } from "../lib/query-keys.js";

export function useAppSettings(enabled = true) {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.appSettings,
    queryFn: fetchAppSettings,
    enabled,
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.appSettings });
  }

  return {
    settings: data ?? (null as AppSettingsDto | null),
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    async update(
      payload: Partial<{
        normal_rate: number;
        rsshub_base_url: string | null;
        rsshub_auth_type: "none" | "basic" | "bearer";
        rsshub_username: string | null;
        rsshub_password: string | null;
        rsshub_bearer_token: string | null;
        rss_request_timeout_ms: number;
      }>,
    ) {
      const result = await updateAppSettings(payload);
      await queryClient.setQueryData(queryKeys.appSettings, result);
      return result;
    },
    refresh,
  };
}
