import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchScheduledTasks } from "@/api/scheduled-tasks.js";
import { queryKeys } from "../../lib/query-keys.js";
import { useAccounts } from "../../hooks/useAccounts.js";

const PROMPT_TASK_KIND = "prompt" as const;

export function useScheduledTasks() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const {
    data: tasksData,
    isPending: loading,
    error: tasksRawError,
  } = useQuery({
    queryKey: queryKeys.scheduledTasks(undefined, PROMPT_TASK_KIND),
    queryFn: () => fetchScheduledTasks(undefined, PROMPT_TASK_KIND),
    staleTime: 15_000,
  });
  const { accounts } = useAccounts();

  const tasks = tasksData ?? [];
  const error =
    tasksRawError instanceof Error
      ? tasksRawError.message
      : tasksRawError
        ? String(tasksRawError)
        : null;

  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return tasks;
    const query = searchQuery.toLowerCase();
    return tasks.filter(
      (task) =>
        task.name.toLowerCase().includes(query) ||
        task.accountId.toLowerCase().includes(query) ||
        task.cron.toLowerCase().includes(query),
    );
  }, [tasks, searchQuery]);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.scheduledTasks(undefined, PROMPT_TASK_KIND),
    });
  };

  const stats = useMemo(() => {
    const enabled = tasks.filter((t) => t.enabled).length;
    const running = tasks.filter((t) => t.status === "running").length;
    const errorCount = tasks.filter((t) => t.status === "error").length;
    const paused = tasks.filter((t) => t.status === "paused").length;
    return { total: tasks.length, enabled, running, error: errorCount, paused };
  }, [tasks]);

  return {
    accounts,
    error,
    expandedTaskId,
    filteredTasks,
    loading,
    refresh,
    searchQuery,
    setExpandedTaskId,
    setSearchQuery,
    stats,
  };
}
