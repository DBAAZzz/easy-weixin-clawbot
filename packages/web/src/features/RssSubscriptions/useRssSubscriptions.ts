import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@clawbot/ui";
import {
  createRssSource,
  deleteRssSource,
  fetchRssSources,
  previewRssSource,
  testRssSource,
  updateRssSource,
  type RssSourceDto,
  type RssSourcePreviewDto,
} from "@/api/rss.js";
import { queryKeys } from "../../lib/query-keys.js";
import { type SourceDraft, EMPTY_DRAFT } from "./types.js";

export function useRssSubscriptions() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<RssSourcePreviewDto | null>(null);

  const {
    data: sources = [],
    isPending: loading,
    error,
  } = useQuery({
    queryKey: queryKeys.rssSources,
    queryFn: fetchRssSources,
    staleTime: 15_000,
  });

  const filteredSources = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return sources;
    }

    return sources.filter((source) => {
      return (
        source.name.toLowerCase().includes(query) ||
        (source.route_path ?? "").toLowerCase().includes(query) ||
        (source.feed_url ?? "").toLowerCase().includes(query)
      );
    });
  }, [searchQuery, sources]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.rssSources });
  }

  async function handleSave() {
    setSaving(true);

    try {
      if (draft.id) {
        await updateRssSource(draft.id, {
          name: draft.name,
          source_type: draft.sourceType,
          route_path: draft.sourceType === "rsshub_route" ? draft.routePath || null : null,
          feed_url: draft.sourceType === "rss_url" ? draft.feedUrl || null : null,
          description: draft.description || null,
          enabled: draft.enabled,
        });
        toast.success(`${draft.name} 已更新`);
      } else {
        await createRssSource({
          name: draft.name,
          source_type: draft.sourceType,
          route_path: draft.sourceType === "rsshub_route" ? draft.routePath || null : null,
          feed_url: draft.sourceType === "rss_url" ? draft.feedUrl || null : null,
          description: draft.description || null,
          enabled: draft.enabled,
        });
        toast.success(`${draft.name} 已创建`);
      }

      setEditorOpen(false);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (saveIssue) {
      toast.error(saveIssue instanceof Error ? saveIssue.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview(source: RssSourceDto, test = false) {
    try {
      const nextPreview = test ? await testRssSource(source.id) : await previewRssSource(source.id);
      setPreview(nextPreview);
      setPreviewOpen(true);
      await refresh();
      if (test) {
        toast.success(`${source.name} 抓取测试完成`);
      }
    } catch (previewIssue) {
      toast.error(previewIssue instanceof Error ? previewIssue.message : "预览失败");
    }
  }

  async function handleDelete(source: RssSourceDto) {
    if (!window.confirm(`确定删除订阅源「${source.name}」吗？`)) {
      return;
    }

    try {
      await deleteRssSource(source.id);
      toast.success(`${source.name} 已删除`);
      await refresh();
    } catch (deleteIssue) {
      toast.error(deleteIssue instanceof Error ? deleteIssue.message : "删除失败");
    }
  }

  async function handleToggle(source: RssSourceDto) {
    try {
      await updateRssSource(source.id, { enabled: !source.enabled });
      toast.success(`${source.name} 已${source.enabled ? "停用" : "启用"}`);
      await refresh();
    } catch (toggleIssue) {
      toast.error(toggleIssue instanceof Error ? toggleIssue.message : "更新失败");
    }
  }

  const stats = useMemo(() => {
    return {
      total: sources.length,
      active: sources.filter((source) => source.enabled).length,
      error: sources.filter((source) => source.status === "error").length,
      referenced: sources.reduce((sum, source) => sum + source.referenced_task_count, 0),
    };
  }, [sources]);

  return {
    sources,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    filteredSources,
    stats,
    editorOpen,
    setEditorOpen,
    previewOpen,
    setPreviewOpen,
    saving,
    draft,
    setDraft,
    preview,
    refresh,
    handleSave,
    handlePreview,
    handleDelete,
    handleToggle,
    setPreview,
  };
}
