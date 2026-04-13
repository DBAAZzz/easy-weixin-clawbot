import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type {
  AccountSummary,
  ConversationRow,
  ModelConfigDto,
  ModelProviderTemplateDto,
  ModelProviderTemplatePingDto,
} from "../../../shared/src/types.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { CardOverflowMenu } from "../components/ui/admin-card.js";
import {
  AlertCircleIcon,
  ChatIcon,
  CheckCircleIcon,
  LayersIcon,
  LinkIcon,
  PulseIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  StackIcon,
  TrashIcon,
  XIcon,
  CpuIcon,
} from "../components/ui/icons.js";
import { Input } from "../components/ui/input.js";
import { Select, type SelectOption } from "../components/ui/select.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccounts } from "../hooks/useAccounts.js";
import { useConversations } from "../hooks/useConversations.js";
import { queryKeys } from "../lib/query-keys.js";
import {
  deleteModelConfig,
  deleteModelProviderTemplate,
  fetchModelConfigs,
  fetchModelProviderTemplates,
  pingModelProviderTemplate,
  updateModelProviderTemplate,
  upsertModelConfig,
} from "@/api/model-config.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";
import { ProviderBrandIcon } from "./model-config/providerBrandIcon.js";
import { resolveNextSelectedModel } from "./model-config/templateForm.js";
import { buildScopeKey, parseScopeSelection } from "./model-config/configForm.js";

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
  account: "muted",
  conversation: "warning",
};

interface ConfigEditorForm {
  scope: "global" | "account" | "conversation";
  scopeKey: string;
  accountId: string;
  conversationId: string;
  purpose: "*" | "chat" | "extraction";
  templateId: string;
  modelId: string;
  enabled: boolean;
  priority: number;
}

const EMPTY_CONFIG_FORM: ConfigEditorForm = {
  scope: "global",
  scopeKey: "*",
  accountId: "",
  conversationId: "",
  purpose: "*",
  templateId: "",
  modelId: "",
  enabled: true,
  priority: 0,
};

function createConfigFormFromDto(dto: ModelConfigDto): ConfigEditorForm {
  const selection = parseScopeSelection(dto.scope, dto.scope_key);
  return {
    scope: dto.scope,
    scopeKey: dto.scope_key,
    accountId: selection.accountId,
    conversationId: selection.conversationId,
    purpose: dto.purpose as ConfigEditorForm["purpose"],
    templateId: dto.template_id,
    modelId: dto.model_id,
    enabled: dto.enabled,
    priority: dto.priority,
  };
}

function createConfigForm(templates: ModelProviderTemplateDto[]): ConfigEditorForm {
  const firstTemplate = templates.find((template) => template.enabled);
  return {
    ...EMPTY_CONFIG_FORM,
    templateId: firstTemplate?.id ?? "",
  };
}

function templateLabel(template: ModelProviderTemplateDto): string {
  return `${template.name} · ${template.provider}`;
}

function accountLabel(account: AccountSummary): string {
  const name = account.alias?.trim() || account.display_name?.trim() || account.id;
  return name === account.id ? account.id : `${name} · ${account.id}`;
}

function conversationLabel(conversation: ConversationRow): string {
  const name = conversation.title?.trim() || conversation.conversation_id;
  return name === conversation.conversation_id
    ? conversation.conversation_id
    : `${name} · ${conversation.conversation_id}`;
}

function ensureSelectedOption(
  options: SelectOption[],
  value: string,
  label: string,
): SelectOption[] {
  if (!value || options.some((option) => option.value === value)) {
    return options;
  }

  return [...options, { value, label }];
}

interface ProviderPingState {
  phase: "idle" | "pending" | "resolved";
  result: ModelProviderTemplatePingDto | null;
}

function createClientPingFailure(
  templateId: string,
  provider: string,
  message: string,
): ModelProviderTemplatePingDto {
  return {
    template_id: templateId,
    provider,
    reachable: false,
    status_code: null,
    latency_ms: null,
    checked_at: new Date().toISOString(),
    endpoint: null,
    message,
    model_count: null,
  };
}

function getPingTone(
  pingState: ProviderPingState | undefined,
): "online" | "muted" | "warning" | "error" {
  if (!pingState || pingState.phase === "idle") {
    return "muted";
  }
  if (pingState.phase === "pending") {
    return "warning";
  }
  if (pingState.result?.reachable) {
    return "online";
  }
  if (
    pingState.result?.message === "未配置 API Key" ||
    pingState.result?.message === "Azure OpenAI 需要 Base URL" ||
    pingState.result?.message === "未配置可探测的 Base URL"
  ) {
    return "warning";
  }
  return "error";
}

function getPingLabel(pingState: ProviderPingState | undefined): string {
  if (!pingState || pingState.phase === "idle") {
    return "检测供应商连通性";
  }
  if (pingState.phase === "pending") {
    return "检测中";
  }
  if (pingState.result?.reachable) {
    return pingState.result.latency_ms ? `连接正常 · ${pingState.result.latency_ms}ms` : "连接正常";
  }
  if (
    pingState.result?.message === "未配置 API Key" ||
    pingState.result?.message === "Azure OpenAI 需要 Base URL" ||
    pingState.result?.message === "未配置可探测的 Base URL"
  ) {
    return pingState.result.message;
  }
  return pingState.result?.status_code ? `连接失败 · ${pingState.result.status_code}` : "连接失败";
}

function formatPingCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPingMeta(pingState: ProviderPingState | undefined): string | null {
  if (!pingState || pingState.phase !== "resolved" || !pingState.result) {
    return null;
  }

  const parts = [`最近检测 ${formatPingCheckedAt(pingState.result.checked_at)}`];
  if (pingState.result.reachable) {
    if (pingState.result.latency_ms !== null) {
      parts.push(`${pingState.result.latency_ms}ms`);
    }
    if (pingState.result.model_count !== null) {
      parts.push(`返回 ${pingState.result.model_count} 个模型`);
    }
  } else {
    parts.push(pingState.result.message);
  }
  return parts.join(" · ");
}

function CardToggle(props: {
  enabled: boolean;
  busy?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.busy}
      aria-label={props.label}
      aria-pressed={props.enabled}
      title={props.enabled ? "已启用" : "已停用"}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onToggle();
      }}
      className={cn(
        "relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        props.enabled ? "border-toggle-border bg-accent" : "border-line-strong bg-toggle-off",
      )}
    >
      <span
        className={cn(
          "size-5 rounded-full bg-white shadow-float transition duration-200 ease-expo",
          props.enabled ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

function PingStatusButton(props: { pingState?: ProviderPingState; onPing: () => void }) {
  const tone = getPingTone(props.pingState);
  const title = getPingLabel(props.pingState);
  const isPending = props.pingState?.phase === "pending";

  return (
    <button
      type="button"
      disabled={isPending}
      aria-label={title}
      title={title}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onPing();
      }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        tone === "online" &&
          "border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-600 hover:border-amber-300 hover:bg-amber-100",
        tone === "error" &&
          "border-red-200 bg-red-50 text-red-600 hover:border-red-300 hover:bg-red-100",
        tone === "muted" &&
          "border-line bg-white text-muted hover:border-line-strong hover:text-muted-strong",
      )}
    >
      {isPending ? (
        <RefreshIcon className="size-3.5 animate-spin" />
      ) : props.pingState?.result?.reachable ? (
        <CheckCircleIcon className="size-3.5" />
      ) : props.pingState?.phase === "resolved" ? (
        <AlertCircleIcon className="size-3.5" />
      ) : (
        <PulseIcon className="size-3.5" />
      )}
    </button>
  );
}

function IconTag(props: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "online" | "offline" | "muted" | "error" | "warning";
}) {
  return (
    <Badge tone={props.tone ?? "muted"} className="gap-1.5 px-2.5 py-1.5 tracking-tag">
      <span className="inline-flex size-3 items-center justify-center opacity-75">
        {props.icon}
      </span>
      <span>{props.children}</span>
    </Badge>
  );
}

function MetricPanel(props: {
  items: Array<{
    icon: ReactNode;
    label: string;
    value: ReactNode;
  }>;
}) {
  return (
    <div className="bg-pane-82 mt-3 grid grid-cols-2 divide-x divide-line overflow-hidden rounded-lg border border-line/80">
      {" "}
      {props.items.map((item) => (
        <div key={item.label} className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <span className="inline-flex size-3.5 items-center justify-center">{item.icon}</span>
            <span>{item.label}</span>
          </div>
          <p className="mt-1 text-md font-medium text-muted-strong">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function ProviderConfigCard(props: {
  template: ModelProviderTemplateDto;
  pingState?: ProviderPingState;
  toggleBusy?: boolean;
  onPing: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { template } = props;

  return (
    <div className="reveal-up group relative rounded-lg border border-card-line bg-glass-90 shadow-card-hover transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-accent-border-strong">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white/90">
          <ProviderBrandIcon provider={template.provider} className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-lg font-semibold tracking-title text-ink">
              {template.name}
            </h3>
          </div>
          <p className="mt-0.5 text-base text-muted">{template.provider}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start">
          <PingStatusButton pingState={props.pingState} onPing={props.onPing} />
          <CardToggle
            enabled={template.enabled}
            busy={props.toggleBusy}
            label={template.enabled ? "停用供应商配置" : "启用供应商配置"}
            onToggle={props.onToggleEnabled}
          />
          <CardOverflowMenu
            items={[
              {
                label: "编辑",
                tone: "primary",
                onClick: props.onEdit,
                icon: <PencilIcon className="size-4" />,
              },
              {
                label: "删除",
                tone: "danger",
                onClick: props.onDelete,
                icon: <TrashIcon className="size-4" />,
              },
            ]}
          />
        </div>
      </div>

      <div className="px-5">
        <MetricPanel
          items={[
            {
              icon: <StackIcon className="size-3.5" />,
              label: "模型数",
              value: formatCount(template.model_ids.length),
            },
            {
              icon: <LinkIcon className="size-3.5" />,
              label: "引用数",
              value: formatCount(template.usage_count),
            },
          ]}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 px-5 pb-4">
        <IconTag icon={<StackIcon className="size-3" />}>
          Model ID {formatCount(template.model_ids.length)}
        </IconTag>
        <IconTag icon={<LinkIcon className="size-3" />}>
          使用配置 {formatCount(template.usage_count)}
        </IconTag>
      </div>

      {getPingMeta(props.pingState) ? (
        <p className="-mt-1 px-5 pb-4 text-sm text-muted">{getPingMeta(props.pingState)}</p>
      ) : null}
    </div>
  );
}

function ModelConfigCard(props: {
  config: ModelConfigDto;
  pingState?: ProviderPingState;
  toggleBusy?: boolean;
  onPing: () => void;
  onToggleEnabled: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { config } = props;

  return (
    <div className="reveal-up group relative rounded-lg border border-card-line bg-glass-90 shadow-card-hover transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-accent-border-strong">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg border",
            config.template_enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-amber-200 bg-amber-50 text-amber-600",
          )}
        >
          <ProviderBrandIcon provider={config.provider} className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="truncate text-lg font-semibold tracking-title text-ink">
              {config.template_name}
            </h3>
          </div>
          <p className="mt-0.5 text-base text-muted">
            {config.provider} / {config.model_id}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start">
          <PingStatusButton pingState={props.pingState} onPing={props.onPing} />
          <CardToggle
            enabled={config.enabled}
            busy={props.toggleBusy}
            label={config.enabled ? "停用使用配置" : "启用使用配置"}
            onToggle={props.onToggleEnabled}
          />
          <CardOverflowMenu
            items={[
              {
                label: "编辑",
                tone: "primary",
                onClick: props.onEdit,
                icon: <PencilIcon className="size-4" />,
              },
              {
                label: "删除",
                tone: "danger",
                onClick: props.onDelete,
                icon: <TrashIcon className="size-4" />,
              },
            ]}
          />
        </div>
      </div>

      <div className="px-5">
        <MetricPanel
          items={[
            {
              icon: <LayersIcon className="size-3.5" />,
              label: "范围",
              value: SCOPE_LABELS[config.scope] || config.scope,
            },
            {
              icon: <ChatIcon className="size-3.5" />,
              label: "用途",
              value: PURPOSE_LABELS[config.purpose] || config.purpose,
            },
          ]}
        />
      </div>

      <div className="mt-2 px-5 text-sm leading-5 text-muted">
        Scope Key：
        <span className="ml-1 font-mono text-muted-strong">
          {config.scope === "global" ? "*" : config.scope_key}
        </span>
        <span className="mx-2 text-line-strong">/</span>
        优先级：
        <span className="ml-1 font-mono text-muted-strong">{config.priority}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 px-5 pb-4">
        <IconTag
          icon={<LayersIcon className="size-3" />}
          tone={SCOPE_TONES[config.scope] || "muted"}
        >
          {SCOPE_LABELS[config.scope] || config.scope}
        </IconTag>
        <IconTag icon={<ChatIcon className="size-3" />}>
          {PURPOSE_LABELS[config.purpose] || config.purpose}
        </IconTag>
        <IconTag
          icon={<LinkIcon className="size-3" />}
          tone={config.template_enabled ? "muted" : "warning"}
        >
          {config.template_enabled ? "供应商可用" : "供应商已停用"}
        </IconTag>
      </div>

      {getPingMeta(props.pingState) ? (
        <p className="px-5 pb-4 text-sm text-muted">{getPingMeta(props.pingState)}</p>
      ) : null}
    </div>
  );
}

function PageSectionHeader(props: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-2xl text-ink">{props.title}</h3>
      </div>

      {props.action ? <div className="flex shrink-0 flex-wrap gap-2">{props.action}</div> : null}
    </div>
  );
}

function ModelConfigEditorModal(props: {
  initial?: ModelConfigDto;
  templates: ModelProviderTemplateDto[];
  accounts: AccountSummary[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const isEdit = Boolean(props.initial);
  const [form, setForm] = useState<ConfigEditorForm>(() =>
    props.initial ? createConfigFormFromDto(props.initial) : createConfigForm(props.templates),
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
  const convAccountId =
    form.scope === "conversation" && form.accountId ? form.accountId : undefined;
  const {
    conversations: conversationData,
    loading: conversationsLoading,
    error: conversationsError,
  } = useConversations(convAccountId);
  const accountOptions = ensureSelectedOption(
    props.accounts.map((account) => ({
      value: account.id,
      label: accountLabel(account),
    })),
    form.accountId,
    `已失效账号 · ${form.accountId}`,
  );
  const conversationOptions = ensureSelectedOption(
    (conversationData ?? []).map((conversation) => ({
      value: conversation.conversation_id,
      label: conversationLabel(conversation),
    })),
    form.conversationId,
    `已失效会话 · ${form.conversationId}`,
  );
  const activeAccountIds = new Set(props.accounts.map((account) => account.id));
  const availableConversationIds = new Set(
    (conversationData ?? []).map((conversation) => conversation.conversation_id),
  );

  useEffect(() => {
    if (!props.initial && !form.templateId && availableTemplates[0]) {
      setForm((current) => ({
        ...current,
        templateId: availableTemplates[0].id,
      }));
    }
  }, [availableTemplates, form.templateId, props.initial]);

  useEffect(() => {
    const nextScopeKey = buildScopeKey(form.scope, form.accountId, form.conversationId);
    if (form.scopeKey === nextScopeKey) {
      return;
    }
    setForm((current) => {
      const derivedScopeKey = buildScopeKey(
        current.scope,
        current.accountId,
        current.conversationId,
      );
      return current.scopeKey === derivedScopeKey
        ? current
        : { ...current, scopeKey: derivedScopeKey };
    });
  }, [form.scope, form.accountId, form.conversationId, form.scopeKey]);

  async function handleSubmit() {
    const scopeKey = buildScopeKey(form.scope, form.accountId, form.conversationId).trim();
    if (!form.templateId) {
      setError("请先选择一个可用供应商配置");
      return;
    }
    if (!form.modelId) {
      setError("请从供应商配置维护的 Model ID 列表中选择一个模型");
      return;
    }
    if (form.scope === "account" && !form.accountId.trim()) {
      setError("请选择账号");
      return;
    }
    if (form.scope === "conversation" && !form.accountId.trim()) {
      setError("请先选择账号");
      return;
    }
    if (form.scope === "conversation" && !form.conversationId.trim()) {
      setError("请选择会话");
      return;
    }
    if (!isEdit && form.scope !== "global" && !activeAccountIds.has(form.accountId.trim())) {
      setError("请选择激活且未废弃的账号");
      return;
    }
    if (!isEdit && form.scope === "conversation" && conversationsLoading) {
      setError("会话列表加载中，请稍后再试");
      return;
    }
    if (
      !isEdit &&
      form.scope === "conversation" &&
      !availableConversationIds.has(form.conversationId.trim())
    ) {
      setError("请选择当前激活账号下可用的会话");
      return;
    }
    if (form.scope !== "global" && !scopeKey) {
      setError("请先完成范围选择");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await upsertModelConfig({
        scope: form.scope,
        scope_key: scopeKey,
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
        className="bg-overlay-strong absolute inset-0 backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-pill border border-modal-border bg-card-hover shadow-modal"
      >
        <div className="border-b border-line px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">
                {isEdit ? "Edit Binding" : "New Binding"}
              </p>
              <h3 className="mt-1.5 text-5xl font-semibold tracking-heading text-ink">
                {isEdit ? "编辑使用配置" : "新建使用配置"}
              </h3>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white/80 text-muted-strong transition hover:border-line-strong hover:text-ink"
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
          <div className="bg-pane-82-cool rounded-xl border border-line px-4 py-4">
            {" "}
            <p className="text-xs uppercase tracking-label-lg text-muted">Scope & Purpose</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["global", "account", "conversation"] as const).map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => setForm((current) => ({ ...current, scope }))}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-base transition",
                    form.scope === scope
                      ? "border-accent bg-accent-soft text-accent-strong"
                      : "border-line text-muted-strong hover:bg-white",
                  )}
                >
                  {SCOPE_LABELS[scope]}
                </button>
              ))}
            </div>
            {form.scope !== "global" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className={cn(form.scope === "account" && "md:col-span-2")}>
                  <label className="text-base text-muted-strong">账号 *</label>
                  <Select
                    value={form.accountId}
                    options={accountOptions}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        accountId: value,
                        conversationId: current.accountId === value ? current.conversationId : "",
                      }))
                    }
                    placeholder={accountOptions.length > 0 ? "选择一个账号" : "暂无可选账号"}
                    className="mt-1"
                    disabled={accountOptions.length === 0}
                  />
                </div>

                {form.scope === "conversation" ? (
                  <div>
                    <label className="text-base text-muted-strong">会话 *</label>
                    <Select
                      value={form.conversationId}
                      options={conversationOptions}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          conversationId: value,
                        }))
                      }
                      placeholder={
                        !form.accountId
                          ? "先选择账号"
                          : conversationsLoading
                            ? "加载会话中..."
                            : conversationOptions.length > 0
                              ? "选择一个会话"
                              : "该账号下暂无会话"
                      }
                      className="mt-1"
                      disabled={
                        !form.accountId || conversationsLoading || conversationOptions.length === 0
                      }
                    />
                    {conversationsError ? (
                      <p className="mt-2 text-sm text-red-600">
                        会话列表加载失败：{conversationsError}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="md:col-span-2">
                  <p className="text-sm text-muted">
                    Scope Key 将自动生成：
                    <span className="ml-1 font-mono text-muted-strong">
                      {form.scopeKey || "请先完成选择"}
                    </span>
                  </p>
                </div>
              </div>
            ) : null}
            <div className="mt-4">
              <p className="text-sm text-muted">用途</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["*", "chat", "extraction"] as const).map((purpose) => (
                  <button
                    key={purpose}
                    type="button"
                    onClick={() => setForm((current) => ({ ...current, purpose }))}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-base transition",
                      form.purpose === purpose
                        ? "border-accent bg-accent-soft text-accent-strong"
                        : "border-line text-muted-strong hover:bg-white",
                    )}
                  >
                    {PURPOSE_LABELS[purpose]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 rounded-xl border border-line bg-white/70 px-4 py-4">
            <div>
              <label className="text-base text-muted-strong">供应商配置 *</label>
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
                placeholder="选择一个供应商配置"
                className="mt-1"
                disabled={availableTemplates.length === 0}
              />
            </div>

            <div>
              <label className="text-base text-muted-strong">Model ID *</label>
              <Select
                value={form.modelId}
                options={modelOptions}
                onChange={(value) => setForm((current) => ({ ...current, modelId: value }))}
                placeholder={
                  selectedTemplate ? "从供应商配置维护的 Model ID 中选择" : "先选择供应商配置"
                }
                className="mt-1"
                disabled={!selectedTemplate}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-base text-muted-strong">优先级</label>
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
                <label className="flex items-center gap-2 text-base text-muted-strong">
                  <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                    className="size-4 rounded accent-accent"
                  />
                  启用此使用配置
                </label>
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
              {error}
            </div>
          ) : null}

          <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-glass-92 px-1 pt-4">
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
  const navigate = useNavigate();
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
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
        enabled: !config.enabled,
        priority: config.priority,
      });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "更新失败");
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
    } catch (err) {
      alert(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="space-y-6 md:space-y-7">
      <section className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Model Control Plane</p>
            <h2 className="mt-1.5 text-6xl text-ink">模型配置管理</h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载模型配置失败：{error}
        </div>
      ) : null}

      <section className="space-y-3">
        <PageSectionHeader
          title="供应商配置"
          action={
            <Button size="sm" onClick={() => navigate("/model-config/providers/new")}>
              <PlusIcon className="size-4" />
              新建供应商配置
            </Button>
          }
        />

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
            <Button
              size="sm"
              className="mt-4"
              onClick={() => navigate("/model-config/providers/new")}
            >
              <PlusIcon className="size-4" />
              新建第一个供应商配置
            </Button>
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
  );
}
