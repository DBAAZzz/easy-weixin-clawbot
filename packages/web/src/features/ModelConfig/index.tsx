import { useNavigate } from "react-router-dom";
import { Button, ConfirmDialog, CpuIcon, PlusIcon } from "@clawbot/ui";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import { ModelConfigCard } from "./ModelConfigCard.js";
import { ModelConfigEditorModal } from "./ModelConfigEditorModal.js";
import { PageSectionHeader } from "./PageSectionHeader.js";
import { ProviderConfigCard } from "./ProviderConfigCard.js";
import { useModelConfigPage } from "./useModelConfigPage.js";

export function ModelConfigPage() {
  const navigate = useNavigate();
  const {
    accounts,
    cancelProviderConfigDelete,
    confirmProviderConfigDelete,
    configEditorTarget,
    setConfigEditorTarget,
    configs,
    deleteConfirmTemplate,
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
  } = useModelConfigPage();

  return (
    <>
      <div className="space-y-6 md:space-y-7">
        <DashboardHeader
          eyebrow="Model Control Plane"
          title="模型配置管理"
          description="管理供应商配置与具体模型使用规则"
          primaryLabel="新建供应商配置"
          refreshLabel="刷新"
          onCreate={() => navigate("/model-config/providers/new")}
          onRefresh={() => void refresh()}
        />

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载模型配置失败：{error}
          </div>
        ) : null}

        <section className="space-y-3">
          <PageSectionHeader title="供应商配置" />

          {loading ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="ui-skeleton h-52 rounded-section" />
              ))}
            </div>
          ) : null}

          {!loading && templates.length === 0 ? (
            <section className="rounded-lg border border-dashed border-line bg-glass-52 px-5 py-10 text-center">
              <CpuIcon className="mx-auto size-8 text-muted" />
              <p className="mt-3 text-xl font-medium text-ink">暂无供应商配置</p>
            </section>
          ) : null}

          {!loading && templates.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {templates.map((template) => (
                <ProviderConfigCard
                  key={template.id}
                  template={template}
                  pingState={pingStates[template.id]}
                  toggleBusy={pendingTemplateToggleId === template.id}
                  onPing={() => void handleProviderPing(template.id, template.provider)}
                  onToggleEnabled={() => void handleProviderToggle(template)}
                  onEdit={() => navigate(`/model-config/providers/${template.id}`)}
                  onDelete={() => void handleProviderConfigDelete(template)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <PageSectionHeader
            title="使用配置"
            action={
              <Button
                size="sm"
                onClick={() => setConfigEditorTarget("create")}
                disabled={templates.every((template) => !template.enabled)}
              >
                <PlusIcon className="size-4" />
                新建使用配置
              </Button>
            }
          />

          {loading ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="ui-skeleton h-44 rounded-section" />
              ))}
            </div>
          ) : null}

          {!loading && templates.length === 0 ? (
            <section className="rounded-lg border border-dashed border-line bg-glass-52 px-5 py-10 text-center">
              <CpuIcon className="mx-auto size-8 text-muted" />
              <p className="mt-3 text-xl font-medium text-ink">暂无供应商配置</p>
            </section>
          ) : null}

          {!loading && templates.length > 0 && configs.length === 0 ? (
            <section className="rounded-lg border border-dashed border-line bg-glass-52 px-5 py-10 text-center">
              <CpuIcon className="mx-auto size-8 text-muted" />
              <p className="mt-3 text-xl font-medium text-ink">还没有使用配置</p>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => setConfigEditorTarget("create")}
                disabled={templates.every((template) => !template.enabled)}
              >
                <PlusIcon className="size-4" />
                新建第一个使用配置
              </Button>
            </section>
          ) : null}

          {!loading && configs.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {configs.map((config) => (
                <ModelConfigCard
                  key={config.id}
                  config={config}
                  pingState={pingStates[config.template_id]}
                  toggleBusy={pendingConfigToggleId === config.id}
                  onPing={() => void handleProviderPing(config.template_id, config.provider)}
                  onToggleEnabled={() => void handleConfigToggle(config)}
                  onEdit={() => setConfigEditorTarget(config)}
                  onDelete={() => void handleConfigDelete(config)}
                />
              ))}
            </div>
          ) : null}
        </section>

        {configEditorTarget ? (
          <ModelConfigEditorModal
            initial={configEditorTarget === "create" ? undefined : configEditorTarget}
            templates={templates}
            accounts={accounts}
            onSaved={() => {
              setConfigEditorTarget(null);
              refresh();
            }}
            onClose={() => setConfigEditorTarget(null)}
          />
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(deleteConfirmTemplate)}
        title="删除供应商配置"
        tone="danger"
        confirmText="删除"
        cancelText="取消"
        closeOnConfirm={false}
        confirmDisabled={
          Boolean(deleteConfirmTemplate) && pendingTemplateToggleId === deleteConfirmTemplate?.id
        }
        onConfirm={() => void confirmProviderConfigDelete()}
        onOpenChange={(open) => {
          if (!open) {
            cancelProviderConfigDelete();
          }
        }}
      >
        {deleteConfirmTemplate ? (
          <p>确认删除 {deleteConfirmTemplate.name}？关联使用配置会一并失效。</p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
