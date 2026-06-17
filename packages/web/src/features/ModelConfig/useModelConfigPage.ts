import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelConfigDto, ModelProviderTemplateDto } from "../../../../shared/src/types.js";
import { toast } from "@clawbot/ui";
import { useAccounts } from "../../hooks/useAccounts.js";
import { queryKeys } from "../../lib/query-keys.js";
import {
  deleteModelConfig,
  deleteModelProviderTemplate,
  fetchModelConfigs,
  fetchModelProviderTemplates,
  pingModelProviderTemplate,
  updateModelProviderTemplate,
  upsertModelConfig,
} from "@/api/model-config.js";
import { createClientPingFailure } from "./PingStatusButton.js";
import type { ProviderPingState } from "./types.js";

export function useModelConfigPage() {
  const queryClient = useQueryClient();
  const {
    data: templatesData,
    isPending: templatesLoading,
    error: templatesError,
  } = useQuery({
    queryKey: queryKeys.modelProviderTemplates,
    queryFn: fetchModelProviderTemplates,
  });
  const {
    data: configsData,
    isPending: configsLoading,
    error: configsError,
  } = useQuery({
    queryKey: queryKeys.modelConfigs,
    queryFn: fetchModelConfigs,
  });
  const {
    accounts,
    loading: accountsLoading,
    error: accountsError,
  } = useAccounts({
    status: "active",
  });

  const loading = templatesLoading || configsLoading || accountsLoading;
  const error =
    (templatesError ?? configsError ?? accountsError)
      ? [templatesError, configsError, accountsError]
          .filter(Boolean)
          .map((e) => (e instanceof Error ? e.message : String(e)))
          .join("; ")
      : null;
  const templates = templatesData ?? [];
  const configs = configsData ?? [];

  const [configEditorTarget, setConfigEditorTarget] = useState<ModelConfigDto | "create" | null>(
    null,
  );
  const [pingStates, setPingStates] = useState<Record<string, ProviderPingState>>({});
  const [pendingTemplateToggleId, setPendingTemplateToggleId] = useState<string | null>(null);
  const [pendingConfigToggleId, setPendingConfigToggleId] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.modelProviderTemplates }),
      queryClient.invalidateQueries({ queryKey: queryKeys.modelConfigs }),
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
    ]);

  useEffect(() => {
    if (!configEditorTarget) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConfigEditorTarget(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [configEditorTarget]);

  async function handleProviderConfigDelete(template: ModelProviderTemplateDto) {
    if (!confirm(`确定要删除供应商配置 ${template.name} 吗？`)) return;
    try {
      await deleteModelProviderTemplate(template.id);
      await refresh();
      toast.success(`供应商配置 ${template.name} 已删除`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleProviderPing(templateId: string, provider: string) {
    setPingStates((current) => ({
      ...current,
      [templateId]: {
        phase: "pending",
        result: current[templateId]?.result ?? null,
      },
    }));

    try {
      const result = await pingModelProviderTemplate(templateId);
      setPingStates((current) => ({
        ...current,
        [templateId]: {
          phase: "resolved",
          result,
        },
      }));
    } catch (err) {
      setPingStates((current) => ({
        ...current,
        [templateId]: {
          phase: "resolved",
          result: createClientPingFailure(
            templateId,
            provider,
            err instanceof Error ? err.message : "连接失败",
          ),
        },
      }));
    }
  }

  async function handleProviderToggle(template: ModelProviderTemplateDto) {
    setPendingTemplateToggleId(template.id);
    try {
      await updateModelProviderTemplate(template.id, {
        name: template.name,
        provider: template.provider,
        model_ids: template.model_ids,
        base_url: template.base_url,
        enabled: !template.enabled,
      });
      await refresh();
      toast.success(`${template.name} 已${template.enabled ? "停用" : "启用"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setPendingTemplateToggleId(null);
    }
  }

  async function handleConfigToggle(config: ModelConfigDto) {
    setPendingConfigToggleId(config.id);
    try {
      await upsertModelConfig({
        scope: config.scope,
        scope_key: config.scope_key,
        purpose: config.purpose,
        template_id: config.template_id,
        model_id: config.model_id,
        supports_image_input_override: config.supports_image_input_override,
        enabled: !config.enabled,
        priority: config.priority,
      });
      await refresh();
      toast.success(
        `${config.template_name}/${config.model_id} 已${config.enabled ? "停用" : "启用"}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setPendingConfigToggleId(null);
    }
  }

  async function handleConfigDelete(config: ModelConfigDto) {
    if (!confirm(`确定要删除使用配置 ${config.template_name}/${config.model_id} 吗？`)) {
      return;
    }
    try {
      await deleteModelConfig(config.id);
      await refresh();
      toast.success(`使用配置 ${config.template_name}/${config.model_id} 已删除`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  }

  return {
    accounts,
    configEditorTarget,
    setConfigEditorTarget,
    configs,
    error,
    handleConfigDelete,
    handleConfigToggle,
    handleProviderConfigDelete,
    handleProviderPing,
    handleProviderToggle,
    loading,
    pendingConfigToggleId,
    pendingTemplateToggleId,
    pingStates,
    refresh,
    templates,
  };
}
