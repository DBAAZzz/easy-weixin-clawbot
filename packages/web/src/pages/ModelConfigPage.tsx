import { useEffect, useState } from "react";
import type {
  ModelConfigDto,
  ModelProviderTemplateDto,
} from "../../../shared/src/types.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import {
  CpuIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon,
  XIcon,
} from "../components/ui/icons.js";
import { Input } from "../components/ui/input.js";
import { Select } from "../components/ui/select.js";
import { useAsyncResource } from "../hooks/use-async-resource.js";
import {
  createModelProviderTemplate,
  deleteModelConfig,
  deleteModelProviderTemplate,
  fetchModelConfigs,
  fetchModelProviderTemplates,
  updateModelProviderTemplate,
  upsertModelConfig,
} from "../lib/api.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";
import {
  MODEL_PROVIDER_PRESETS,
  type ModelProviderPreset,
} from "./model-config/providerPresets.js";
import {
  normalizeModelIdList,
  resolveNextSelectedModel,
} from "./model-config/templateForm.js";

const SCOPE_LABELS: Record<string, string> = {
  global: "全局",
  account: "账号级",
  conversation: "会话级",
};

const PURPOSE_LABELS: Record<string, string> = {
  chat: "对话",
  extraction: "记忆提取",
  "*": "全部",
};

const SCOPE_TONES: Record<string, "online" | "muted" | "warning"> = {
  global: "muted",
  account: "online",
  conversation: "warning",
};

type TemplateEditorState =
  | { mode: "create"; preset?: ModelProviderPreset }
  | { mode: "edit"; templateId: string };

interface TemplateEditorForm {
  name: string;
  provider: string;
  modelIds: string[];
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  clearApiKey: boolean;
  apiKeySet: boolean;
  baseUrlPlaceholder?: string;
}

interface ConfigEditorForm {
  scope: "global" | "account" | "conversation";
  scopeKey: string;
  purpose: "*" | "chat" | "extraction";
  templateId: string;
  modelId: string;
  enabled: boolean;
  priority: number;
}

const EMPTY_TEMPLATE_FORM: TemplateEditorForm = {
  name: "",
  provider: "",
  modelIds: [""],
  apiKey: "",
  baseUrl: "",
  enabled: true,
  clearApiKey: false,
  apiKeySet: false,
};

const EMPTY_CONFIG_FORM: ConfigEditorForm = {
  scope: "global",
  scopeKey: "*",
  purpose: "*",
  templateId: "",
  modelId: "",
  enabled: true,
  priority: 0,
};

function createTemplateForm(preset?: ModelProviderPreset): TemplateEditorForm {
  return {
    ...EMPTY_TEMPLATE_FORM,
    name: preset ? `${preset.label} Template` : "",
    provider: preset?.provider ?? "",
    baseUrl: "",
    baseUrlPlaceholder: preset?.baseUrlPlaceholder,
  };
}

function createTemplateFormFromDto(
  template: ModelProviderTemplateDto,
): TemplateEditorForm {
  const preset = MODEL_PROVIDER_PRESETS.find(
    (item) => item.provider === template.provider,
  );
  return {
    name: template.name,
    provider: template.provider,
    modelIds:
      template.model_ids.length > 0
        ? [...template.model_ids, ""]
        : [""],
    apiKey: "",
    baseUrl: template.base_url ?? "",
    enabled: template.enabled,
    clearApiKey: false,
    apiKeySet: template.api_key_set,
    baseUrlPlaceholder: preset?.baseUrlPlaceholder,
  };
}

function createConfigFormFromDto(dto: ModelConfigDto): ConfigEditorForm {
  return {
    scope: dto.scope,
    scopeKey: dto.scope_key,
    purpose: dto.purpose as ConfigEditorForm["purpose"],
    templateId: dto.template_id,
    modelId: dto.model_id,
    enabled: dto.enabled,
    priority: dto.priority,
  };
}

function createConfigForm(
  templates: ModelProviderTemplateDto[],
): ConfigEditorForm {
  const firstTemplate = templates.find((template) => template.enabled);
  return {
    ...EMPTY_CONFIG_FORM,
    templateId: firstTemplate?.id ?? "",
  };
}

function templateLabel(template: ModelProviderTemplateDto): string {
  return `${template.name} · ${template.provider}`;
}

function ModelConfigCard(props: {
  config: ModelConfigDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { config } = props;
  const statusTone = config.enabled
    ? config.template_enabled
      ? "online"
      : "warning"
    : "offline";

  return (
    <div className="reveal-up group rounded-[24px] border border-[rgba(21,32,43,0.08)] bg-[rgba(255,255,255,0.9)] shadow-[0_22px_55px_-42px_rgba(15,23,42,0.45)] transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[rgba(21,110,99,0.18)]">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[14px] border",
            config.template_enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-amber-200 bg-amber-50 text-amber-600",
          )}
        >
          <CpuIcon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold tracking-[-0.03em] text-[var(--ink)]">
              {config.template_name}
            </h3>
            <Badge tone={statusTone}>
              {config.enabled
                ? config.template_enabled
                  ? "生效中"
                  : "模板已停用"
                : "停用"}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {config.provider} / {config.model_id}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 px-5 text-[12px]">
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">范围：</span>
          {SCOPE_LABELS[config.scope] || config.scope}
        </div>
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">用途：</span>
          {PURPOSE_LABELS[config.purpose] || config.purpose}
        </div>
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">Scope Key：</span>
          {config.scope === "global" ? "*" : config.scope_key}
        </div>
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">优先级：</span>
          {config.priority}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1 px-5 pb-4">
        <Badge tone={SCOPE_TONES[config.scope] || "muted"}>
          {SCOPE_LABELS[config.scope] || config.scope}
        </Badge>
        <Badge tone="muted">{PURPOSE_LABELS[config.purpose] || config.purpose}</Badge>
        <Badge tone={config.template_enabled ? "muted" : "warning"}>
          {config.template_enabled ? "模板可用" : "模板停用"}
        </Badge>
      </div>

      <div className="flex items-center border-t border-[var(--line)]/40 px-4 py-2">
        <button
          type="button"
          onClick={props.onEdit}
          className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-strong)] transition hover:bg-[rgba(21,110,99,0.06)] hover:text-[var(--accent-strong)]"
        >
          <PencilIcon className="size-3.5" />
          编辑绑定
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={props.onDelete}
          className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium text-red-500 transition hover:bg-red-50 hover:text-red-600"
        >
          <TrashIcon className="size-3.5" />
          删除
        </button>
      </div>
    </div>
  );
}

function ModelConfigEditorModal(props: {
  initial?: ModelConfigDto;
  templates: ModelProviderTemplateDto[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(props.initial);
  const [form, setForm] = useState<ConfigEditorForm>(() =>
    props.initial
      ? createConfigFormFromDto(props.initial)
      : createConfigForm(props.templates),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTemplates = props.initial
    ? props.templates.filter(
        (template) => template.enabled || template.id === props.initial?.template_id,
      )
    : props.templates.filter((template) => template.enabled);
  const selectedTemplate =
    availableTemplates.find((template) => template.id === form.templateId) ?? null;
  const modelOptions = (selectedTemplate?.model_ids ?? []).map((modelId: string) => ({
    value: modelId,
    label: modelId,
  }));

  useEffect(() => {
    if (!props.initial && !form.templateId && availableTemplates[0]) {
      setForm((current) => ({
        ...current,
        templateId: availableTemplates[0].id,
      }));
    }
  }, [availableTemplates, form.templateId, props.initial]);

  useEffect(() => {
    if (form.scope === "global") {
      setForm((current) =>
        current.scopeKey === "*"
          ? current
          : { ...current, scopeKey: "*" },
      );
      return;
    }
    if (form.scopeKey === "*") {
      setForm((current) => ({ ...current, scopeKey: "" }));
    }
  }, [form.scope, form.scopeKey]);

  async function handleSubmit() {
    if (!form.templateId) {
      setError("请先选择一个可用模板");
      return;
    }
    if (!form.modelId) {
      setError("请从模板维护的 Model ID 列表中选择一个模型");
      return;
    }
    if (form.scope !== "global" && !form.scopeKey.trim()) {
      setError("请填写 Scope Key（账号 ID 或 账号ID:会话ID）");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await upsertModelConfig({
        scope: form.scope,
        scope_key: form.scope === "global" ? "*" : form.scopeKey.trim(),
        purpose: form.purpose,
        template_id: form.templateId,
        model_id: form.modelId,
        enabled: form.enabled,
        priority: form.priority,
      });
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭模型绑定弹窗"
        onClick={props.onClose}
        className="absolute inset-0 bg-[rgba(15,23,42,0.28)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                {isEdit ? "Edit Binding" : "New Binding"}
              </p>
              <h3 className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]">
                {isEdit ? "编辑使用配置" : "新建使用配置"}
              </h3>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </div>

        <form
          className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(246,249,250,0.82)] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Scope & Purpose
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {(["global", "account", "conversation"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, scope }))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] transition",
                    form.scope === scope
                      ? "border-[var(--accent)] bg-[rgba(21,110,99,0.1)] text-[var(--accent-strong)]"
                      : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-white",
                  )}
                >
                  {SCOPE_LABELS[scope]}
                </button>
              ))}
            </div>

            {form.scope !== "global" ? (
              <div className="mt-3">
                <label className="text-[12px] text-[var(--muted-strong)]">
                  {form.scope === "account" ? "账号 ID *" : "账号ID:会话ID *"}
                </label>
                <Input
                  value={form.scopeKey}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scopeKey: event.target.value,
                    }))
                  }
                  placeholder={
                    form.scope === "account"
                      ? "例如 wxid_abc123"
                      : "例如 wxid_abc123:conv_001"
                  }
                  className="mt-1"
                />
              </div>
            ) : null}

            <div className="mt-4">
              <p className="text-[11px] text-[var(--muted)]">用途</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["*", "chat", "extraction"] as const).map((purpose) => (
                  <button
                    key={purpose}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({ ...current, purpose }))
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] transition",
                      form.purpose === purpose
                        ? "border-[var(--accent)] bg-[rgba(21,110,99,0.1)] text-[var(--accent-strong)]"
                        : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-white",
                    )}
                  >
                    {PURPOSE_LABELS[purpose]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-[22px] border border-[var(--line)] bg-white/70 px-4 py-4">
            <div>
              <label className="text-[12px] text-[var(--muted-strong)]">模板 *</label>
              <Select
                value={form.templateId}
                options={availableTemplates.map((template) => ({
                  value: template.id,
                  label: templateLabel(template),
                }))}
                onChange={(value) => {
                  const nextTemplate =
                    availableTemplates.find((template) => template.id === value) ?? null;
                  setForm((current) => ({
                    ...current,
                    templateId: value,
                    modelId: resolveNextSelectedModel(
                      current.modelId,
                      nextTemplate?.model_ids ?? [],
                    ),
                  }));
                }}
                placeholder="选择一个模板"
                className="mt-1"
                disabled={availableTemplates.length === 0}
              />
            </div>

            <div>
              <label className="text-[12px] text-[var(--muted-strong)]">
                Model ID *
              </label>
              <Select
                value={form.modelId}
                options={modelOptions}
                onChange={(value) =>
                  setForm((current) => ({ ...current, modelId: value }))
                }
                placeholder={
                  selectedTemplate
                    ? "从模板维护的 Model ID 中选择"
                    : "先选择模板"
                }
                className="mt-1"
                disabled={!selectedTemplate}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">优先级</label>
                <Input
                  type="number"
                  value={String(form.priority)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priority: Number(event.target.value) || 0,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-[12px] text-[var(--muted-strong)]">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                    className="size-4 rounded accent-[var(--accent)]"
                  />
                  启用此使用配置
                </label>
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
              {error}
            </div>
          ) : null}

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-[var(--line)] bg-[rgba(255,255,255,0.92)] px-1 pt-4">
            <Button type="button" variant="outline" onClick={props.onClose}>
              取消
            </Button>
            <Button disabled={busy || availableTemplates.length === 0} type="submit">
              {busy ? "保存中..." : isEdit ? "保存更改" : "创建绑定"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ModelConfigPage() {
  const [revision, setRevision] = useState(0);
  const { data, loading, error } = useAsyncResource(
    async () => {
      const [templates, configs] = await Promise.all([
        fetchModelProviderTemplates(),
        fetchModelConfigs(),
      ]);
      return { templates, configs };
    },
    [revision],
  );
  const templates = data?.templates ?? [];
  const configs = data?.configs ?? [];
  const [templateEditor, setTemplateEditor] = useState<TemplateEditorState | null>(null);
  const [templateForm, setTemplateForm] = useState<TemplateEditorForm>(
    EMPTY_TEMPLATE_FORM,
  );
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [configEditorTarget, setConfigEditorTarget] = useState<
    ModelConfigDto | "create" | null
  >(null);

  const refresh = () => setRevision((current) => current + 1);
  const enabledTemplateCount = templates.filter((template) => template.enabled).length;
  const activeConfigCount = configs.filter((config) => config.enabled && config.template_enabled).length;
  const stats = [
    { label: "Provider 模板", value: formatCount(templates.length) },
    { label: "启用模板", value: formatCount(enabledTemplateCount) },
    { label: "使用配置", value: formatCount(configs.length) },
    { label: "生效配置", value: formatCount(activeConfigCount) },
  ];
  const activeTemplate =
    templateEditor?.mode === "edit"
      ? templates.find((template) => template.id === templateEditor.templateId) ?? null
      : null;

  useEffect(() => {
    if (templateEditor) {
      if (
        templateEditor.mode === "edit" &&
        !templates.some((template) => template.id === templateEditor.templateId)
      ) {
        setTemplateEditor(
          templates[0] ? { mode: "edit", templateId: templates[0].id } : { mode: "create" },
        );
      }
      return;
    }

    setTemplateEditor(
      templates[0] ? { mode: "edit", templateId: templates[0].id } : { mode: "create" },
    );
  }, [templateEditor, templates]);

  useEffect(() => {
    if (!templateEditor) {
      return;
    }

    setTemplateError(null);
    if (templateEditor.mode === "create") {
      setTemplateForm(createTemplateForm(templateEditor.preset));
      return;
    }

    const template = templates.find(
      (item) => item.id === templateEditor.templateId,
    );
    if (template) {
      setTemplateForm(createTemplateFormFromDto(template));
    }
  }, [templateEditor, templates]);

  useEffect(() => {
    if (!configEditorTarget) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setConfigEditorTarget(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [configEditorTarget]);

  async function handleTemplateSave() {
    const modelIds = normalizeModelIdList(templateForm.modelIds);
    if (!templateForm.name.trim() || !templateForm.provider.trim()) {
      setTemplateError("Name 和 Provider 为必填项");
      return;
    }
    if (modelIds.length === 0) {
      setTemplateError("请至少维护一个 Model ID");
      return;
    }

    setTemplateBusy(true);
    setTemplateError(null);
    try {
      if (templateEditor?.mode === "edit" && activeTemplate) {
        const updated = await updateModelProviderTemplate(activeTemplate.id, {
          name: templateForm.name.trim(),
          provider: templateForm.provider.trim(),
          model_ids: modelIds,
          ...(templateForm.apiKey.trim()
            ? { api_key: templateForm.apiKey.trim() }
            : {}),
          ...(templateForm.clearApiKey ? { clear_api_key: true } : {}),
          base_url: templateForm.baseUrl.trim() || null,
          enabled: templateForm.enabled,
        });
        setTemplateEditor({ mode: "edit", templateId: updated.id });
      } else {
        const created = await createModelProviderTemplate({
          name: templateForm.name.trim(),
          provider: templateForm.provider.trim(),
          model_ids: modelIds,
          api_key: templateForm.apiKey.trim() || null,
          base_url: templateForm.baseUrl.trim() || null,
          enabled: templateForm.enabled,
        });
        setTemplateEditor({ mode: "edit", templateId: created.id });
      }
      refresh();
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setTemplateBusy(false);
    }
  }

  async function handleTemplateDelete(template: ModelProviderTemplateDto) {
    if (!confirm(`确定要删除模板 ${template.name} 吗？`)) return;
    try {
      await deleteModelProviderTemplate(template.id);
      setTemplateEditor(null);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleConfigDelete(config: ModelConfigDto) {
    if (!confirm(`确定要删除绑定 ${config.template_name}/${config.model_id} 吗？`)) {
      return;
    }
    try {
      await deleteModelConfig(config.id);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="space-y-3 md:space-y-4">
      <section className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.26em] text-[var(--muted)]">
              Model Control Plane
            </p>
            <h2 className="mt-1.5 text-[20px] text-[var(--ink)]">模型配置管理</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
          <div className="grid divide-y divide-[var(--line)] md:grid-cols-4 md:divide-x md:divide-y-0">
            {stats.map((stat) => (
              <div key={stat.label} className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  {stat.label}
                </p>
                <p className="mt-1.5 font-[var(--font-mono)] text-[18px] font-semibold text-[var(--ink)]">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载模型配置失败：{error}
        </div>
      ) : null}

      <section className="space-y-0">
        <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
          <div className="border-b border-[var(--line)] px-3 py-3 md:px-4">
            <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                  Provider Templates
                </p>
                <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">模板与 Provider</h3>
              </div>

              <Button size="sm" onClick={() => setTemplateEditor({ mode: "create" })}>
                <PlusIcon className="size-4" />
                新建模板
              </Button>
            </div>
          </div>

          <div className="grid xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="border-b border-[var(--line)] bg-[rgba(246,249,250,0.78)] px-3 py-3 xl:border-b-0 xl:border-r md:px-4">
              <div className="space-y-2">
                {loading
                  ? Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="ui-skeleton h-20 rounded-[12px]" />
                    ))
                  : null}

                {!loading && templates.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-[var(--line)] bg-white/70 px-4 py-6 text-center text-[12px] text-[var(--muted)]">
                    暂无 Provider 模板
                  </div>
                ) : null}

                {!loading
                  ? templates.map((template) => {
                      const selected =
                        templateEditor?.mode === "edit" &&
                        templateEditor.templateId === template.id;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() =>
                            setTemplateEditor({ mode: "edit", templateId: template.id })
                          }
                          className={cn(
                            "w-full rounded-[12px] border px-3 py-3 text-left transition",
                            selected
                              ? "border-[rgba(21,110,99,0.2)] bg-[rgba(21,110,99,0.06)]"
                              : "border-[var(--line)] bg-white/84 hover:border-[var(--line-strong)] hover:bg-white",
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-semibold text-[var(--ink)]">
                                {template.name}
                              </div>
                              <p className="mt-1 truncate text-[11px] text-[var(--muted)]">
                                {template.provider}
                              </p>
                            </div>
                            <Badge tone={template.enabled ? "online" : "offline"}>
                              {template.enabled ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            <Badge tone="muted">模型 {formatCount(template.model_ids.length)}</Badge>
                            <Badge tone="muted">引用 {formatCount(template.usage_count)}</Badge>
                          </div>
                        </button>
                      );
                    })
                  : null}
              </div>

              <div className="mt-4 border-t border-[var(--line)] pt-4">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  Provider 预设
                </p>
                <div className="mt-3 grid gap-2">
                  {MODEL_PROVIDER_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setTemplateEditor({ mode: "create", preset })}
                      className="rounded-[12px] border border-[var(--line)] bg-white/84 px-3 py-3 text-left transition hover:border-[var(--line-strong)] hover:bg-white"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] font-semibold text-[var(--ink)]">
                          {preset.label}
                        </span>
                        <PlusIcon className="size-3.5 text-[var(--muted)]" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>

            <div className="px-3 py-3 md:px-4 md:py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                    {templateEditor?.mode === "edit" ? "Template Detail" : "New Template"}
                  </p>
                  <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">
                    {templateEditor?.mode === "edit" ? "编辑 Provider 模板" : "新建 Provider 模板"}
                  </h3>
                </div>

                {activeTemplate ? (
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={activeTemplate.enabled ? "online" : "offline"}>
                      {activeTemplate.enabled ? "已启用" : "已停用"}
                    </Badge>
                    <Badge tone="muted">模型 {formatCount(activeTemplate.model_ids.length)}</Badge>
                    <Badge tone="muted">引用 {formatCount(activeTemplate.usage_count)}</Badge>
                  </div>
                ) : null}
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
                <div className="space-y-5">
                  <div>
                    <label className="text-[12px] text-[var(--muted-strong)]">模板名称 *</label>
                    <Input
                      value={templateForm.name}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="例如 OpenAI Main"
                      className="mt-1"
                    />
                  </div>

                  <div>
                    <label className="text-[12px] text-[var(--muted-strong)]">Provider *</label>
                    <Input
                      value={templateForm.provider}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          provider: event.target.value,
                        }))
                      }
                      placeholder="openai / anthropic / moonshot"
                      className="mt-1"
                    />
                  </div>

                  <div className="rounded-[14px] border border-[var(--line)] bg-[rgba(246,249,250,0.82)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-medium text-[var(--muted-strong)]">
                          Model ID 列表 *
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setTemplateForm((current) => ({
                            ...current,
                            modelIds: [...current.modelIds, ""],
                          }))
                        }
                      >
                        <PlusIcon className="size-4" />
                        添加
                      </Button>
                    </div>

                    <div className="mt-4 space-y-2">
                      {templateForm.modelIds.map((value, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            value={value}
                            onChange={(event) =>
                              setTemplateForm((current) => ({
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
                              setTemplateForm((current) => ({
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
                      value={templateForm.apiKey}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          apiKey: event.target.value,
                        }))
                      }
                      placeholder={
                        templateEditor?.mode === "edit" && templateForm.apiKeySet
                          ? "已设置，留空则不修改"
                          : "sk-..."
                      }
                      className="mt-1"
                    />
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted)]">
                      <input
                        type="checkbox"
                        checked={templateForm.clearApiKey}
                        onChange={(event) =>
                          setTemplateForm((current) => ({
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
                      value={templateForm.baseUrl}
                      onChange={(event) =>
                        setTemplateForm((current) => ({
                          ...current,
                          baseUrl: event.target.value,
                        }))
                      }
                      placeholder={
                        templateForm.baseUrlPlaceholder ??
                        "https://api.example.com/v1"
                      }
                      className="mt-1"
                    />
                  </div>

                  <div className="rounded-[14px] border border-[var(--line)] bg-[rgba(252,253,253,0.9)] p-4">
                    <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                      模板状态
                    </p>
                    <label className="mt-3 flex items-center gap-2 text-[12px] text-[var(--muted-strong)]">
                      <input
                        type="checkbox"
                        checked={templateForm.enabled}
                        onChange={(event) =>
                          setTemplateForm((current) => ({
                            ...current,
                            enabled: event.target.checked,
                          }))
                        }
                        className="size-4 rounded accent-[var(--accent)]"
                      />
                      启用此模板
                    </label>
                  </div>
                </div>
              </div>

              {templateError ? (
                <div className="mt-5 rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
                  {templateError}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-[var(--line)] pt-4">
                {activeTemplate ? (
                  <Button
                    variant="destructive"
                    onClick={() => handleTemplateDelete(activeTemplate)}
                  >
                    <TrashIcon className="size-4" />
                    删除模板
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  onClick={() => setTemplateEditor({ mode: "create" })}
                >
                  新建空白模板
                </Button>
                <Button disabled={templateBusy} onClick={() => void handleTemplateSave()}>
                  {templateBusy
                    ? "保存中..."
                    : templateEditor?.mode === "edit"
                      ? "保存模板"
                      : "创建模板"}
                </Button>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--line)] px-3 py-3 md:px-4">
            <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                  Runtime Bindings
                </p>
                <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">使用配置</h3>
              </div>

              <Button
                size="sm"
                onClick={() => setConfigEditorTarget("create")}
                disabled={templates.every((template) => !template.enabled)}
              >
                <PlusIcon className="size-4" />
                新建使用配置
              </Button>
            </div>
          </div>

          <div className="px-3 pb-3 md:px-4 md:pb-4">
            {loading ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="ui-skeleton h-44 rounded-[18px]" />
                ))}
              </div>
            ) : null}

            {!loading && templates.length === 0 ? (
              <section className="rounded-[18px] border border-dashed border-[var(--line)] bg-[rgba(248,250,251,0.78)] px-5 py-10 text-center">
                <CpuIcon className="mx-auto size-8 text-[var(--muted)]" />
                <p className="mt-3 text-[15px] font-medium text-[var(--ink)]">
                  暂无 Provider 模板
                </p>
              </section>
            ) : null}

            {!loading && templates.length > 0 && configs.length === 0 ? (
              <section className="rounded-[18px] border border-dashed border-[var(--line)] bg-[rgba(248,250,251,0.78)] px-5 py-10 text-center">
                <CpuIcon className="mx-auto size-8 text-[var(--muted)]" />
                <p className="mt-3 text-[15px] font-medium text-[var(--ink)]">
                  还没有使用配置
                </p>
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
                    onEdit={() => setConfigEditorTarget(config)}
                    onDelete={() => void handleConfigDelete(config)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {configEditorTarget ? (
        <ModelConfigEditorModal
          initial={configEditorTarget === "create" ? undefined : configEditorTarget}
          templates={templates}
          onSaved={() => {
            setConfigEditorTarget(null);
            refresh();
          }}
          onClose={() => setConfigEditorTarget(null)}
        />
      ) : null}
    </div>
  );
}
