import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  Input,
  Button,
  Breadcrumb,
  CardToggle,
  Select,
} from "@clawbot/ui";
import type { SelectOption } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";
import {
  createModelProviderTemplate,
  deleteModelProviderTemplate,
  fetchModelProviderTemplates,
  updateModelProviderTemplate,
} from "@/api/model-config.js";
import { queryKeys } from "../../lib/query-keys.js";
import { ProviderBrandIcon } from "./providerBrandIcon.js";
import {
  createProviderConfigForm,
  createProviderConfigFormFromDto,
  type ProviderConfigFormState,
} from "./providerConfigForm.js";
import { MODEL_PROVIDER_PRESETS, type ModelProviderPreset } from "./providerPresets.js";
import { normalizeModelIdList } from "./templateForm.js";

export function ProviderConfigPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { providerConfigId } = useParams();
  const isEdit = Boolean(providerConfigId);
  const [selectedPreset, setSelectedPreset] = useState<ModelProviderPreset | undefined>();
  const [form, setForm] = useState<ProviderConfigFormState>(() => createProviderConfigForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: providerConfigsData, error: loadError } = useQuery({
    queryKey: queryKeys.modelProviderTemplates,
    queryFn: fetchModelProviderTemplates,
  });

  const providerConfigs = providerConfigsData ?? [];
  const activeProviderConfig = useMemo(
    () =>
      providerConfigId
        ? (providerConfigs.find((item) => item.id === providerConfigId) ?? null)
        : null,
    [providerConfigId, providerConfigs],
  );

  const activePreset = useMemo(() => {
    if (!isEdit) return selectedPreset;
    if (!form.provider.trim()) return undefined;
    return MODEL_PROVIDER_PRESETS.find((item) => item.provider === form.provider);
  }, [isEdit, selectedPreset, form.provider]);

  const suggestedModelIds = useMemo(() => {
    const existing = new Set(form.modelIds.map((value) => value.trim()).filter(Boolean));
    return (activePreset?.suggestedModelIds ?? []).filter((id) => !existing.has(id));
  }, [activePreset, form.modelIds]);

  const providerOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: SelectOption[] = [];
    for (const preset of MODEL_PROVIDER_PRESETS) {
      const value = preset.provider.trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      options.push({
        value,
        label: value,
        icon: <ProviderBrandIcon provider={value} className="size-4" />,
      });
    }
    const current = form.provider.trim();
    if (current && !seen.has(current)) {
      options.unshift({ value: current, label: current });
    }
    return options;
  }, [form.provider]);

  function addModelId(value: string) {
    setForm((current) => {
      const trimmed = current.modelIds.filter((item) => item.trim());
      return { ...current, modelIds: [...trimmed, value] };
    });
  }

  useEffect(() => {
    setError(null);

    if (isEdit) {
      if (activeProviderConfig) {
        setForm(createProviderConfigFormFromDto(activeProviderConfig));
      }
      return;
    }

    setForm(createProviderConfigForm(selectedPreset));
  }, [activeProviderConfig, isEdit, selectedPreset]);

  const pageTitle = isEdit ? "编辑供应商配置" : "新建供应商配置";

  function goBackToModelConfig() {
    if (typeof window !== "undefined" && (window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
    } else {
      navigate("/model-config");
    }
  }

  async function handleSave() {
    const modelIds = normalizeModelIdList(form.modelIds);
    if (!form.name.trim() || !form.provider.trim()) {
      setError("配置名称和 Provider 为必填项");
      return;
    }
    if (modelIds.length === 0) {
      setError("请至少维护一个 Model ID");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (isEdit && activeProviderConfig) {
        await updateModelProviderTemplate(activeProviderConfig.id, {
          name: form.name.trim(),
          provider: form.provider.trim(),
          model_ids: modelIds,
          ...(form.apiKey.trim() ? { api_key: form.apiKey.trim() } : {}),
          ...(form.clearApiKey ? { clear_api_key: true } : {}),
          base_url: form.baseUrl.trim() || null,
          enabled: form.enabled,
        });
      } else {
        await createModelProviderTemplate({
          name: form.name.trim(),
          provider: form.provider.trim(),
          model_ids: modelIds,
          api_key: form.apiKey.trim() || null,
          base_url: form.baseUrl.trim() || null,
          enabled: form.enabled,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.modelProviderTemplates,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      navigate("/model-config");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!activeProviderConfig) return;
    if (!confirm(`确定要删除供应商配置 ${activeProviderConfig.name} 吗？`)) return;

    try {
      await deleteModelProviderTemplate(activeProviderConfig.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.modelProviderTemplates,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      navigate("/model-config");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="space-y-6 md:space-y-7">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-control border border-line bg-panel p-4 shadow-card backdrop-blur-xl">
        <Breadcrumb
          backHref="/model-config"
          className="text-base"
          items={[
            { label: "模型配置", href: "/model-config" },
            { label: pageTitle, current: true },
          ]}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) {
              event.preventDefault();
              goBackToModelConfig();
            }
          }}
        />

        <div className="flex items-center gap-2">
          {isEdit && activeProviderConfig ? (
            <Button size="sm" variant="danger" onClick={() => void handleDelete()}>
              <TrashIcon className="size-4" />
              删除
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => navigate("/model-config")}>
            取消
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void handleSave()}>
            {busy ? "保存中..." : isEdit ? "保存供应商配置" : "创建供应商配置"}
          </Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载供应商配置失败：
          {loadError instanceof Error ? loadError.message : String(loadError)}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          {error}
        </div>
      ) : null}

      <div
        className={cn(
          "grid overflow-hidden rounded-section border border-line bg-panel shadow-card backdrop-blur-xl",
          !isEdit && "xl:grid-cols-[280px_minmax(0,1fr)]",
        )}
      >
        {!isEdit ? (
          <aside className="space-y-3 border-b border-line p-5 xl:border-b-0 xl:border-r">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-ink">供应商预设</h3>
              {selectedPreset ? (
                <button
                  type="button"
                  onClick={() => setSelectedPreset(undefined)}
                  className="inline-flex items-center gap-1 text-sm text-muted transition hover:text-ink"
                >
                  <RefreshIcon className="size-3.5" />
                  清空
                </button>
              ) : null}
            </div>

            <div className="space-y-1.5">
              {MODEL_PROVIDER_PRESETS.map((preset) => {
                const selected = selectedPreset?.provider === preset.provider;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setSelectedPreset(preset)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-control border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-accent-border-active bg-accent-mist-strong"
                        : "border-transparent hover:border-line hover:bg-hover-bg",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                        selected
                          ? "border-accent-border-active bg-white"
                          : "border-line bg-hover-bg",
                      )}
                    >
                      <ProviderBrandIcon provider={preset.provider} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-md font-semibold text-ink">
                        {preset.label}
                      </span>
                      <span className="block truncate font-mono text-sm text-muted">
                        {preset.provider || "custom"}
                      </span>
                    </span>
                    {selected ? <CheckIcon className="size-4 shrink-0 text-accent" /> : null}
                  </button>
                );
              })}
            </div>
          </aside>
        ) : null}

        <form
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="px-5 sm:px-6">
            <FieldRow label="配置名称 *" description="用于在列表中识别该供应商配置">
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="例如 DeepSeek 主供应商"
              />
            </FieldRow>

            <FieldRow label="Provider *" description="协议适配器，随预设自动填入">
              <Select
                fullWidth
                value={form.provider}
                options={providerOptions}
                onChange={(value) => setForm((current) => ({ ...current, provider: value }))}
                placeholder="选择协议适配器"
              />
            </FieldRow>

            <FieldRow label="Model ID 列表 *" description="该配置下可调用的模型标识，可添加多个">
              <div className="space-y-2">
                {form.modelIds.map((value, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={value}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          modelIds: current.modelIds.map((modelId, itemIndex) =>
                            itemIndex === index ? event.target.value : modelId,
                          ),
                        }))
                      }
                      placeholder="例如 gpt-5"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          modelIds:
                            current.modelIds.length === 1
                              ? [""]
                              : current.modelIds.filter((_item, itemIndex) => itemIndex !== index),
                        }))
                      }
                      aria-label="删除 Model ID"
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      modelIds: [...current.modelIds, ""],
                    }))
                  }
                  className="flex w-full items-center justify-center gap-1.5 rounded-control border border-dashed border-line-strong px-3 py-2.5 text-base text-muted-strong transition hover:border-accent-border-active hover:text-accent"
                >
                  <PlusIcon className="size-4" />
                  添加模型
                </button>

                {suggestedModelIds.length ? (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-sm font-medium text-muted-strong">建议模型 · 点击添加</p>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestedModelIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => addModelId(id)}
                          className="inline-flex items-center gap-1 rounded-pill border border-line bg-hover-bg px-2.5 py-1 font-mono text-sm text-muted-strong transition hover:border-accent-border-active hover:text-accent"
                        >
                          <PlusIcon className="size-3" />
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </FieldRow>

            <FieldRow
              label="API Key"
              description={
                isEdit && form.apiKeySet
                  ? "已配置 · 出于安全仅显示掩码，留空则保留原密钥"
                  : "用于鉴权的密钥，仅本地存储"
              }
            >
              <Input
                type="password"
                value={form.apiKey}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder={isEdit && form.apiKeySet ? "留空则不修改" : "sk-..."}
              />
              {isEdit && form.apiKeySet ? (
                <label className="mt-2 flex items-center gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    checked={form.clearApiKey}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        clearApiKey: event.target.checked,
                        apiKey: event.target.checked ? "" : current.apiKey,
                      }))
                    }
                    className="size-4 rounded accent-accent"
                  />
                  <span>保存时清空已配置的 API Key</span>
                </label>
              ) : null}
            </FieldRow>

            <FieldRow label="Base URL" description="自定义 API 端点，留空使用默认地址">
              <Input
                value={form.baseUrl}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    baseUrl: event.target.value,
                  }))
                }
                placeholder={form.baseUrlPlaceholder ?? "https://api.example.com/v1"}
              />
            </FieldRow>

            <FieldRow label="启用配置" description="停用后该供应商配置不会被模型调用">
              <CardToggle
                enabled={form.enabled}
                label={form.enabled ? "停用供应商配置" : "启用供应商配置"}
                onToggle={() =>
                  setForm((current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }))
                }
              />
            </FieldRow>
          </div>
        </form>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-x-6 gap-y-2 border-t border-line py-5 first:border-t-0 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div>
        <label className="text-base font-medium text-ink">{label}</label>
        {description ? <p className="mt-1 text-sm leading-5 text-muted">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
