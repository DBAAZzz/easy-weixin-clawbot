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
    async update(payload: { normal_rate: number }) {
      const result = await updateAppSettings(payload);
      await queryClient.setQueryData(queryKeys.appSettings, result);
      return result;
    },
    refresh,
  };
}
