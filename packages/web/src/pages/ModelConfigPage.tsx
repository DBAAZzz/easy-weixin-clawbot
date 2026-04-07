import { useEffect, useState } from "react";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import {
  CpuIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  RefreshIcon,
  XIcon,
} from "../components/ui/icons.js";
import { useAsyncResource } from "../hooks/use-async-resource.js";
import {
  fetchModelConfigs,
  upsertModelConfig,
  deleteModelConfig,
} from "../lib/api.js";
import type { ModelConfigDto } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";

// ── Constants ─────────────────────────────────────────────────────────

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

// ── Card Component ────────────────────────────────────────────────────

function ModelConfigCard(props: {
  config: ModelConfigDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { config } = props;

  return (
    <div className="reveal-up group rounded-[20px] border border-[rgba(21,32,43,0.08)] bg-[rgba(255,255,255,0.88)] transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[rgba(21,110,99,0.14)] hover:bg-[rgba(255,255,255,0.96)]">
      {/* Row 1: icon + provider/model + badges */}
      <div className="flex items-center gap-3 px-5 pt-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-[12px] border transition",
            config.enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-[var(--line)] bg-[rgba(148,163,184,0.08)] text-[var(--muted)]",
          )}
        >
          <CpuIcon className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold tracking-[-0.02em] text-[var(--ink)]">
              {config.provider} / {config.model_id}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
            {SCOPE_LABELS[config.scope] || config.scope} &middot;{" "}
            {config.scope === "global" ? "所有账号" : config.scope_key}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={config.enabled ? "online" : "offline"}>
            {config.enabled ? "启用" : "停用"}
          </Badge>
        </div>
      </div>

      {/* Row 2: info grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 px-5 text-[12px]">
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">用途：</span>
          {PURPOSE_LABELS[config.purpose] || config.purpose}
        </div>
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">优先级：</span>
          {config.priority}
        </div>
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">API Key：</span>
          {config.api_key_set ? "已设置" : "使用环境变量"}
        </div>
        <div className="text-[var(--muted-strong)]">
          <span className="text-[var(--muted)]">Base URL：</span>
          {config.base_url ? "自定义" : "默认"}
        </div>
      </div>

      {/* Scope pills */}
      <div className="mt-2 flex flex-wrap gap-1 px-5 pb-3.5">
        <Badge tone={SCOPE_TONES[config.scope] || "muted"}>
          {SCOPE_LABELS[config.scope] || config.scope}
        </Badge>
        <Badge tone="muted">{PURPOSE_LABELS[config.purpose] || config.purpose}</Badge>
      </div>

      {/* Action bar */}
      <div className="flex items-center border-t border-[var(--line)]/40 px-4 py-1.5">
        <button
          type="button"
          onClick={props.onEdit}
          className="inline-flex items-center gap-1 rounded-[8px] px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted-strong)] transition hover:bg-[rgba(21,110,99,0.06)] hover:text-[var(--accent-strong)]"
        >
          <PencilIcon className="size-3.5" />
          编辑
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

// ── Editor Modal ──────────────────────────────────────────────────────

interface EditorForm {
  scope: "global" | "account" | "conversation";
  scopeKey: string;
  purpose: string;
  provider: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  priority: number;
}

const EMPTY_FORM: EditorForm = {
  scope: "global",
  scopeKey: "*",
  purpose: "*",
  provider: "",
  modelId: "",
  apiKey: "",
  baseUrl: "",
  enabled: true,
  priority: 0,
};

function fromDto(dto: ModelConfigDto): EditorForm {
  return {
    scope: dto.scope,
    scopeKey: dto.scope_key,
    purpose: dto.purpose,
    provider: dto.provider,
    modelId: dto.model_id,
    apiKey: "",
    baseUrl: dto.base_url || "",
    enabled: dto.enabled,
    priority: dto.priority,
  };
}

function ModelConfigEditorModal(props: {
  initial?: ModelConfigDto;
  onSaved: () => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(props.initial);
  const [form, setForm] = useState<EditorForm>(
    props.initial ? fromDto(props.initial) : EMPTY_FORM,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Auto-adjust scopeKey when scope changes
  useEffect(() => {
    if (form.scope === "global") {
      update("scopeKey", "*");
    } else if (form.scopeKey === "*") {
      update("scopeKey", "");
    }
  }, [form.scope]);

  async function handleSubmit() {
    if (!form.provider.trim() || !form.modelId.trim()) {
      setError("Provider 和 Model ID 为必填项");
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
        provider: form.provider.trim(),
        model_id: form.modelId.trim(),
        api_key: form.apiKey.trim() || null,
        base_url: form.baseUrl.trim() || null,
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
        aria-label="关闭模型配置弹窗"
        onClick={props.onClose}
        className="absolute inset-0 bg-[rgba(15,23,42,0.24)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        {/* Header */}
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                {isEdit ? "Edit Config" : "New Config"}
              </p>
              <h3 className="mt-1.5 text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]">
                {isEdit ? "编辑模型配置" : "新建模型配置"}
              </h3>
              <p className="mt-2 text-[13px] leading-6 text-[var(--muted)]">
                设置 LLM 供应商和模型，支持按用途、账号、会话粒度配置。
              </p>
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

        {/* Form */}
        <form
          className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          {/* Scope & Purpose */}
          <div className="rounded-[22px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
            <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Scope & Purpose
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              {(["global", "account", "conversation"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => update("scope", s)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] transition",
                    form.scope === s
                      ? "border-[var(--accent)] bg-[rgba(21,110,99,0.1)] text-[var(--accent-strong)]"
                      : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-white",
                  )}
                >
                  {SCOPE_LABELS[s]}
                </button>
              ))}
            </div>

            {form.scope !== "global" && (
              <div className="mt-3">
                <label className="text-[12px] text-[var(--muted-strong)]">
                  {form.scope === "account" ? "账号 ID *" : "账号ID:会话ID *"}
                </label>
                <Input
                  value={form.scopeKey}
                  onChange={(e) => update("scopeKey", e.target.value)}
                  placeholder={
                    form.scope === "account"
                      ? "例如 wxid_abc123"
                      : "例如 wxid_abc123:conv_001"
                  }
                  className="mt-1"
                />
              </div>
            )}

            <div className="mt-4">
              <p className="text-[11px] text-[var(--muted)]">用途</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["*", "chat", "extraction"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => update("purpose", p)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] transition",
                      form.purpose === p
                        ? "border-[var(--accent)] bg-[rgba(21,110,99,0.1)] text-[var(--accent-strong)]"
                        : "border-[var(--line)] text-[var(--muted-strong)] hover:bg-white",
                    )}
                  >
                    {PURPOSE_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Provider & Model */}
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">Provider *</label>
                <Input
                  value={form.provider}
                  onChange={(e) => update("provider", e.target.value)}
                  placeholder="anthropic / openai / moonshot"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">Model ID *</label>
                <Input
                  value={form.modelId}
                  onChange={(e) => update("modelId", e.target.value)}
                  placeholder="claude-sonnet-4-20250514"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">
                  API Key <span className="text-[var(--muted)]">(留空使用环境变量)</span>
                </label>
                <Input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => update("apiKey", e.target.value)}
                  placeholder={isEdit && props.initial?.api_key_set ? "已设置，留空则不修改" : "sk-..."}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">
                  Base URL <span className="text-[var(--muted)]">(可选)</span>
                </label>
                <Input
                  value={form.baseUrl}
                  onChange={(e) => update("baseUrl", e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-[var(--muted-strong)]">优先级</label>
                <Input
                  type="number"
                  value={String(form.priority)}
                  onChange={(e) => update("priority", Number(e.target.value) || 0)}
                  placeholder="0"
                  className="mt-1"
                />
                <p className="mt-1 text-[10px] text-[var(--muted)]">数值越大优先级越高</p>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-[12px] text-[var(--muted-strong)]">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(e) => update("enabled", e.target.checked)}
                    className="size-4 rounded accent-[var(--accent)]"
                  />
                  启用此配置
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
            <Button disabled={busy} type="submit">
              {busy ? "保存中..." : isEdit ? "保存更改" : "创建配置"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

export function ModelConfigPage() {
  const [revision, setRevision] = useState(0);
  const { data: configs, loading, error } = useAsyncResource(
    () => fetchModelConfigs(),
    [revision],
  );
  const [editorTarget, setEditorTarget] = useState<ModelConfigDto | "create" | null>(null);

  const refresh = () => setRevision((r) => r + 1);
  const items = configs ?? [];
  const globalCount = items.filter((c) => c.scope === "global").length;
  const accountCount = items.filter((c) => c.scope === "account").length;
  const conversationCount = items.filter((c) => c.scope === "conversation").length;

  useEffect(() => {
    if (!editorTarget) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setEditorTarget(null);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorTarget]);

  const handleDelete = async (config: ModelConfigDto) => {
    if (!confirm(`确定要删除 ${config.provider}/${config.model_id} 的配置？此操作不可恢复。`))
      return;
    try {
      await deleteModelConfig(config.id);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              Model Config
            </p>
            <h2 className="mt-1.5 text-[24px] text-[var(--ink)]">模型配置管理</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-6 text-[var(--muted)]">
              配置不同 LLM 供应商和模型，支持按用途（对话/记忆提取）、按账号、按会话粒度设置，运行时动态生效。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
            <Button size="sm" onClick={() => setEditorTarget("create")}>
              <PlusIcon className="size-4" />
              新建配置
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
            <Badge tone="muted">总数 {formatCount(items.length)}</Badge>
            <Badge tone="muted">全局 {formatCount(globalCount)}</Badge>
            <Badge tone="online">账号级 {formatCount(accountCount)}</Badge>
            <Badge tone="warning">会话级 {formatCount(conversationCount)}</Badge>
          </div>

          <div className="rounded-[16px] border border-[var(--line)] bg-[rgba(255,255,255,0.72)] px-4 py-2 text-[11px] text-[var(--muted)]">
            优先级链：会话级 &gt; 账号级 &gt; 全局 &gt; 环境变量默认。无配置时使用 .env 中的 LLM_PROVIDER/LLM_MODEL。
          </div>
        </div>
      </section>

      {/* Error */}
      {error ? (
        <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载模型配置失败：{error}
        </div>
      ) : null}

      {/* Loading skeleton */}
      {loading ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[rgba(255,255,255,0.8)] px-4 py-4 md:px-5"
            >
              <div className="flex items-center gap-3">
                <div className="ui-skeleton size-10 rounded-[14px]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="ui-skeleton h-5 rounded-[8px]" />
                  <div className="ui-skeleton h-4 rounded-[8px]" />
                  <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                </div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="ui-skeleton h-3 rounded-full" />
                <div className="ui-skeleton h-3 w-4/5 rounded-full" />
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* Empty state */}
      {!loading && items.length === 0 && !editorTarget ? (
        <section className="rounded-[28px] border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.48)] px-5 py-10 text-center">
          <CpuIcon className="mx-auto size-8 text-[var(--muted)]" />
          <p className="mt-3 text-[15px] font-medium text-[var(--ink)]">暂无模型配置</p>
          <p className="mt-2 text-[12px] leading-6 text-[var(--muted)]">
            当前使用环境变量默认模型。新建配置后可按用途、账号、会话粒度指定不同的 LLM。
          </p>
          <Button size="sm" className="mt-4" onClick={() => setEditorTarget("create")}>
            <PlusIcon className="size-4" />
            新建第一个配置
          </Button>
        </section>
      ) : null}

      {/* Config cards */}
      {!loading && items.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <CpuIcon className="size-4 text-[var(--muted-strong)]" />
            <span>当前展示 {formatCount(items.length)} 个模型配置</span>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {items.map((config) => (
              <ModelConfigCard
                key={config.id}
                config={config}
                onEdit={() => setEditorTarget(config)}
                onDelete={() => handleDelete(config)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Editor modal */}
      {editorTarget ? (
        <ModelConfigEditorModal
          initial={editorTarget === "create" ? undefined : editorTarget}
          onSaved={() => {
            setEditorTarget(null);
            refresh();
          }}
          onClose={() => setEditorTarget(null)}
        />
      ) : null}
    </div>
  );
}
