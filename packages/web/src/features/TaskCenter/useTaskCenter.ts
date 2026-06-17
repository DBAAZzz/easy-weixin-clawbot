import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "@clawbot/ui";
import {
  createRssTask,
  deleteRssTask,
  fetchRssSources,
  fetchRssTasks,
  previewRssTask,
  runRssTaskNow,
  updateRssTask,
  type RssTaskDto,
  type RssTaskPreviewDto,
} from "@/api/rss.js";
import { useAccounts } from "../../hooks/useAccounts.js";
import { queryKeys } from "../../lib/query-keys.js";
import { EMPTY_TASK_DRAFT, type TaskDraft } from "./types.js";

export function useTaskCenter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { accounts } = useAccounts();
  const accountIdFilter = searchParams.get("accountId") ?? undefined;
  const [searchQuery, setSearchQuery] = useState("");
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [editingTask, setEditingTask] = useState<RssTaskDto | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [preview, setPreview] = useState<RssTaskPreviewDto | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [runsTask, setRunsTask] = useState<RssTaskDto | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    data: tasks = [],
    isPending: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.rssTasks(accountIdFilter),
    queryFn: () => fetchRssTasks(accountIdFilter),
    staleTime: 15_000,
  });

  const { data: sources = [] } = useQuery({
    queryKey: queryKeys.rssSources,
    queryFn: fetchRssSources,
    staleTime: 15_000,
  });

  const filteredTasks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return tasks;
    }

    return tasks.filter((task) => {
      return (
        task.name.toLowerCase().includes(query) ||
        task.account_id.toLowerCase().includes(query) ||
        task.sources.some((source) => source.name.toLowerCase().includes(query))
      );
    });
  }, [searchQuery, tasks]);

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ id: source.id, name: source.name })),
    [sources],
  );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.rssTasks(accountIdFilter) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.rssSources });
  }

  async function handleSave() {
    setSaving(true);

    try {
      const payload = {
        account_id: draft.accountId,
        name: draft.name,
        task_kind: draft.taskKind,
        cron: draft.cronPreset === "custom" ? draft.cron : draft.cronPreset,
        timezone: draft.timezone,
        source_ids: draft.sourceIds,
        max_items: Number.parseInt(draft.maxItems, 10),
        enabled: draft.enabled,
        type: draft.type,
        silent_window: draft.silentWindowEnabled
          ? { start: draft.silentStart, end: draft.silentEnd }
          : null,
      };

      if (editingTask) {
        await updateRssTask(editingTask.account_id, editingTask.seq, payload);
        toast.success(`${draft.name} 已更新`);
      } else {
        await createRssTask(payload);
        toast.success(`${draft.name} 已创建`);
      }

      setEditorOpen(false);
      setEditingTask(null);
      setDraft(EMPTY_TASK_DRAFT);
      await refresh();
    } catch (saveIssue) {
      toast.error(saveIssue instanceof Error ? saveIssue.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function openPreview(task: RssTaskDto) {
    try {
      const nextPreview = await previewRssTask(task.account_id, task.seq);
      setPreview(nextPreview);
      setPreviewOpen(true);
    } catch (previewIssue) {
      toast.error(previewIssue instanceof Error ? previewIssue.message : "预览失败");
    }
  }

  async function handleRunNow(task: RssTaskDto) {
    try {
      const result = await runRssTaskNow(task.account_id, task.seq);
      toast.success(
        result.run?.status === "success" ? `${task.name} 执行成功` : `${task.name} 已执行`,
      );
      await refresh();
      await queryClient.invalidateQueries({
        queryKey: queryKeys.scheduledTaskRuns(task.account_id, task.seq),
      });
    } catch (runIssue) {
      toast.error(runIssue instanceof Error ? runIssue.message : "执行失败");
    }
  }

  async function handleDelete(task: RssTaskDto) {
    if (!window.confirm(`确定删除任务「${task.name}」吗？`)) {
      return;
    }

    try {
      await deleteRssTask(task.account_id, task.seq);
      toast.success(`${task.name} 已删除`);
      await refresh();
    } catch (deleteIssue) {
      toast.error(deleteIssue instanceof Error ? deleteIssue.message : "删除失败");
    }
  }

  const stats = useMemo(() => {
    return {
      total: tasks.length,
      enabled: tasks.filter((task) => task.enabled).length,
      running: tasks.filter((task) => task.status === "running").length,
      errors: tasks.filter((task) => task.status === "error").length,
    };
  }, [tasks]);

  return {
    accounts,
    accountIdFilter,
    draft,
    editingTask,
    editorOpen,
    error,
    filteredTasks,
    loading,
    navigate,
    preview,
    previewOpen,
    queryClient,
    refresh,
    runsTask,
    saving,
    searchQuery,
    setDraft,
    setEditingTask,
    setEditorOpen,
    setPreviewOpen,
    setRunsTask,
    setSearchParams,
    setSearchQuery,
    sourceOptions,
    stats,
    handleSave,
    handleDelete,
    handleRunNow,
    openPreview,
  };
}
