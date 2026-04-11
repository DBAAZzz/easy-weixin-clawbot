import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  disableTool,
  enableTool,
  fetchTools,
  installTool,
  removeTool,
  updateTool,
} from "../lib/api.js";
import { queryKeys } from "../lib/query-keys.js";

export function useTools() {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.tools,
    queryFn: fetchTools,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.tools });
  }

  return {
    tools: data ?? [],
    loading: isPending,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    async install(markdown: string) {
      const result = await installTool(markdown);
      invalidate();
      return result;
    },
    async update(name: string, markdown: string) {
      const result = await updateTool(name, markdown);
      invalidate();
      return result;
    },
    async enable(name: string) {
      const result = await enableTool(name);
      invalidate();
      return result;
    },
    async disable(name: string) {
      const result = await disableTool(name);
      invalidate();
      return result;
    },
    async remove(name: string) {
      const result = await removeTool(name);
      invalidate();
      return result;
    },
    refresh: invalidate,
  };
}
