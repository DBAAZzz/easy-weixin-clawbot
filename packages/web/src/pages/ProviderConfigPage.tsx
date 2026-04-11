import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CardToggle } from "../components/ui/admin-card.js";
import { Button } from "../components/ui/button.js";
import {
  ArrowRightIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  XIcon,
} from "../components/ui/icons.js";
import { Input } from "../components/ui/input.js";
import {
  createModelProviderTemplate,
  deleteModelProviderTemplate,
  fetchModelProviderTemplates,
  updateModelProviderTemplate,
} from "../lib/api.js";
import { queryKeys } from "../lib/query-keys.js";
import { ProviderBrandIcon } from "./model-config/providerBrandIcon.js";
import {
  createProviderConfigForm,
  createProviderConfigFormFromDto,
  type ProviderConfigFormState,
} from "./model-config/providerConfigForm.js";
import {
  MODEL_PROVIDER_PRESETS,
  type ModelProviderPreset,
} from "./model-config/providerPresets.js";
import { normalizeModelIdList } from "./model-config/templateForm.js";

export function ProviderConfigPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { providerConfigId } = useParams();
  const isEdit = Boolean(providerConfigId);
  const [selectedPreset, setSelectedPreset] = useState<ModelProviderPreset | undefined>();
  const [form, setForm] = useState<ProviderConfigFormState>(() =>
    createProviderConfigForm(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    data: providerConfigsData,
    isPending: loading,
    error: loadError,
  } = useQuery({
    queryKey: queryKeys.modelProviderTemplates,
    queryFn: fetchModelProviderTemplates,
  });

  const providerConfigs = providerConfigsData ?? [];
  const activeProviderConfig = useMemo(
    () =>
      providerConfigId
        ? providerConfigs.find((item) => item.id === providerConfigId) ?? null
        : null,
    [providerConfigId, providerConfigs],
  );

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

      await queryClient.invalidateQueries({ queryKey: queryKeys.modelProviderTemplates });
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelProviderTemplates });
      await queryClient.invalidateQueries({ queryKey: queryKeys.modelConfigs });
      navigate("/model-config");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  if (isEdit && !loading && !activeProviderConfig) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/model-config")}>
          <ArrowRightIcon className="size-4 rotate-180" />
          返回模型配置
        </Button>
        <div className="rounded-lg border border-[rgba(185,28,28,0.14)] bg-[rgba(254,242,242,0.92)] px-5 py-5 text-[13px] text-red-700">
          未找到对应的供应商配置，可能已被删除。
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-7">
      <section className="space-y-2.5">
        <Button variant="ghost" onClick={() => navigate("/model-config")}>
          <ArrowRightIcon className="size-4 rotate-180" />
          返回模型配置
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[20px] text-[var(--ink)]">{pageTitle}</h2>
          {isEdit && activeProviderConfig ? (
            <div className="text-[12px] text-[var(--muted)]">{activeProviderConfig.provider}</div>
          ) : null}
        </div>
      </section>

      {loadError ? (
        <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载供应商配置失败：{loadError instanceof Error ? loadError.message : String(loadError)}
        </div>
      ) : null}

      {!isEdit ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[16px] text-[var(--ink)]">供应商预设</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedPreset(undefined)}
            >
              <RefreshIcon className="size-4" />
              清空预设
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {MODEL_PROVIDER_PRESETS.map((preset) => {
              const selected = selectedPreset?.provider === preset.provider;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setSelectedPreset(preset)}
                  className={[
                    "rounded-[18px] border px-4 py-4 text-left transition",
                    selected
                      ? "border-[rgba(21,110,99,0.2)] bg-[rgba(21,110,99,0.07)]"
                      : "border-[var(--line)] bg-white/84 hover:border-[var(--line-strong)] hover:bg-white",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-[var(--line)] bg-[rgba(246,249,250,0.9)]">
                      <ProviderBrandIcon provider={preset.provider} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-[var(--ink)]">
                        {preset.label}
                      </span>
                      <span className="mt-1 block text-[11px] leading-5 text-[var(--muted)]">
                        {preset.provider}
                      </span>
                      {preset.suggestedModelIds?.length ? (
                        <span className="mt-2 block text-[11px] text-[var(--muted-strong)]">
                          {preset.suggestedModelIds.join(" / ")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="mt-1 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-5">
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">
                  配置名称 *
                </label>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="例如 DeepSeek 主供应商"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">
                  Provider *
                </label>
                <Input
                  value={form.provider}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      provider: event.target.value,
                    }))
                  }
                  placeholder="openai / anthropic / moonshot"
                  className="mt-1"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className="text-[12px] font-medium text-[var(--muted-strong)]">
                    Model ID 列表 *
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        modelIds: [...current.modelIds, ""],
                      }))
                    }
                  >
                    <PlusIcon className="size-4" />
                    添加
                  </Button>
                </div>

                <div className="mt-3 space-y-2">
                  {form.modelIds.map((value, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
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
                        size="icon"
                        variant="outline"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            modelIds:
                              current.modelIds.length === 1
                                ? [""]
                                : current.modelIds.filter(
                                    (_item, itemIndex) => itemIndex !== index,
                                  ),
                          }))
                        }
                        aria-label="删除 Model ID"
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">
                  API Key
                </label>
                <Input
                  type="password"
                  value={form.apiKey}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={isEdit && form.apiKeySet ? "已设置，留空则不修改" : "sk-..."}
                  className="mt-1"
                />
                <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
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
                    className="size-4 rounded accent-[var(--accent)]"
                  />
                  <span>清空已保存的 API Key</span>
                </div>
              </div>

              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">
                  Base URL
                </label>
                <Input
                  value={form.baseUrl}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder={form.baseUrlPlaceholder ?? "https://api.example.com/v1"}
                  className="mt-1"
                />
              </div>

              <div className="flex items-center justify-between rounded-[14px] border border-[var(--line)] bg-[rgba(252,253,253,0.9)] px-3 py-2.5">
                <p className="text-[12px] text-[var(--muted-strong)]">启用此供应商配置</p>
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
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {isEdit && activeProviderConfig ? (
              <Button variant="destructive" onClick={() => void handleDelete()}>
                <TrashIcon className="size-4" />
                删除供应商配置
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => navigate("/model-config")}>
              取消
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? "保存中..." : isEdit ? "保存供应商配置" : "创建供应商配置"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
