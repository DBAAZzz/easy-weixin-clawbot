import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@clawbot/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchWebhookTokens,
  toggleWebhookToken,
  rotateWebhookToken,
  deleteWebhookToken,
} from "@/api/webhooks.js";
import { queryKeys } from "@/lib/query-keys.js";
import { useAccounts } from "@/hooks/useAccounts.js";

export function useWebhooks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: tokensResp,
    isPending: loading,
    error: tokensError,
  } = useQuery({
    queryKey: queryKeys.webhookTokens,
    queryFn: fetchWebhookTokens,
  });
  const { accounts } = useAccounts();

  const [showCreate, setShowCreate] = useState(false);
  const [activeTestSource, setActiveTestSource] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);

  const tokens = tokensResp?.data ?? [];
  const error =
    tokensError instanceof Error ? tokensError.message : tokensError ? String(tokensError) : null;
  const activeTestToken = tokens.find((token) => token.source === activeTestSource) ?? null;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.webhookTokens });
  };
  const enabledCount = tokens.filter((token) => token.enabled).length;
  const disabledCount = tokens.length - enabledCount;
  const activeAccountCount = new Set(tokens.flatMap((token) => token.accountIds)).size;

  useEffect(() => {
    if (!showCreate && !activeTestToken) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (activeTestToken) {
        setActiveTestSource(null);
        return;
      }

      setShowCreate(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTestToken, showCreate]);

  const handleToggle = async (source: string, enabled: boolean) => {
    setPendingToggle(source);
    try {
      await toggleWebhookToken(source, !enabled);
      refresh();
      toast.success(`${source} 已${enabled ? "停用" : "启用"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setPendingToggle(null);
    }
  };

  const handleRotate = async (source: string) => {
    if (!confirm(`确定要轮换 ${source} 的 Token？旧 Token 将立即失效。`)) return;
    try {
      const result = await rotateWebhookToken(source);
      setCreatedToken(result.token);
      refresh();
      toast.success(`${source} 的 Token 已轮换`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "轮换失败");
    }
  };

  const handleDelete = async (source: string) => {
    if (!confirm(`确定要删除 ${source}？此操作不可恢复。`)) return;
    try {
      await deleteWebhookToken(source);
      refresh();
      toast.success(`${source} 已删除`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleOpenLogs = (source: string) => {
    navigate(`/webhooks/${encodeURIComponent(source)}/logs`);
  };

  return {
    tokens,
    error,
    loading,
    accounts,
    showCreate,
    setShowCreate,
    activeTestSource,
    setActiveTestSource,
    createdToken,
    setCreatedToken,
    activeTestToken,
    pendingToggle,
    enabledCount,
    disabledCount,
    activeAccountCount,
    refresh,
    handleToggle,
    handleRotate,
    handleDelete,
    handleOpenLogs,
  };
}
