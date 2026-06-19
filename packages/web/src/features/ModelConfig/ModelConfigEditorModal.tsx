import { useEffect, useState } from "react";
import type {
  AccountSummary,
  ModelConfigDto,
  ModelProviderTemplateDto,
} from "../../../../shared/src/types.js";
import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  Input,
  Select,
} from "@clawbot/ui";
import { useConversations } from "../../hooks/useConversations.js";
import { cn } from "../../lib/cn.js";
import { upsertModelConfig } from "@/api/model-config.js";
import { buildScopeKey } from "../ProviderConfig/configForm.js";
import { resolveNextSelectedModel } from "../ProviderConfig/templateForm.js";
import {
  SCOPE_LABELS,
  PURPOSE_LABELS,
  VISION_OVERRIDE_LABELS,
  createConfigFormFromDto,
  createConfigForm,
  templateLabel,
  accountLabel,
  conversationLabel,
  ensureSelectedOption,
  type ConfigEditorForm,
} from "./types.js";

export function ModelConfigEditorModal(props: {
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
        supports_image_input_override: form.supportsImageInputOverride,
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
    <Dialog open onOpenChange={() => props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-xl rounded-dialog">
          <DialogHeader status={<DialogClose />}>
            <div className="min-w-0">
              <DialogTitle className="text-2xl md:text-4xl">
                {isEdit ? "编辑使用配置" : "新建使用配置"}
              </DialogTitle>
              <p className="mt-1.5 text-sm leading-5 text-muted">
                为供应商模型指定使用范围和优先级
              </p>
            </div>
          </DialogHeader>

          <DialogBody className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmit();
              }}
              className="space-y-4"
            >
              <fieldset className="rounded-panel border border-line bg-pane-82-cool px-4 py-4">
                <legend className="text-xs font-medium uppercase tracking-label text-muted">
                  范围与用途
                </legend>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["global", "account", "conversation"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, scope }))}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm transition",
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
                      <label className="text-sm font-medium text-muted-strong">账号 *</label>
                      <Select
                        size="sm"
                        value={form.accountId}
                        options={accountOptions}
                        onChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            accountId: value,
                            conversationId:
                              current.accountId === value ? current.conversationId : "",
                          }))
                        }
                        placeholder={accountOptions.length > 0 ? "选择一个账号" : "暂无可选账号"}
                        className="mt-1"
                        disabled={accountOptions.length === 0}
                      />
                    </div>

                    {form.scope === "conversation" ? (
                      <div>
                        <label className="text-sm font-medium text-muted-strong">会话 *</label>
                        <Select
                          size="sm"
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
                            !form.accountId ||
                            conversationsLoading ||
                            conversationOptions.length === 0
                          }
                        />
                        {conversationsError ? (
                          <p className="mt-1.5 text-xs text-danger">
                            会话列表加载失败：{conversationsError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="md:col-span-2">
                      <p className="text-xs text-muted">
                        Scope Key：
                        <span className="ml-1 font-mono text-muted-strong">
                          {form.scopeKey || "请先完成选择"}
                        </span>
                      </p>
                    </div>
                  </div>
                ) : null}
                <div className="mt-3">
                  <p className="text-sm font-medium text-muted-strong">用途</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(["*", "chat", "extraction", "vision"] as const).map((purpose) => (
                      <button
                        key={purpose}
                        type="button"
                        onClick={() => setForm((current) => ({ ...current, purpose }))}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition",
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
              </fieldset>

              <fieldset className="rounded-panel border border-line bg-white/70 px-4 py-4">
                <legend className="text-xs font-medium uppercase tracking-label text-muted">
                  模型配置
                </legend>
                <div className="mt-3 space-y-4">
                  <div>
                    <label className="text-sm font-medium text-muted-strong">供应商配置 *</label>
                    <Select
                      size="sm"
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
                    <label className="text-sm font-medium text-muted-strong">Model ID *</label>
                    <Select
                      size="sm"
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

                  <div>
                    <p className="text-sm font-medium text-muted-strong">视觉输入能力覆盖</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["default", "supported", "unsupported"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              supportsImageInputOverride: value,
                            }))
                          }
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-sm transition",
                            form.supportsImageInputOverride === value
                              ? "border-accent bg-accent-soft text-accent-strong"
                              : "border-line text-muted-strong hover:bg-white",
                          )}
                        >
                          {VISION_OVERRIDE_LABELS[value]}
                        </button>
                      ))}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted">
                      仅在静态能力表无法判断自定义模型时手动覆盖。
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium text-muted-strong">优先级</label>
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
                      <label className="flex items-center gap-2 text-sm text-muted-strong">
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
              </fieldset>

              {error ? (
                <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-sm leading-5 text-danger">
                  {error}
                </div>
              ) : null}

              <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-glass-92 px-1 pt-4">
                <Button size="sm" type="button" variant="secondary" onClick={props.onClose}>
                  取消
                </Button>
                <Button size="sm" disabled={busy || availableTemplates.length === 0} type="submit">
                  {busy ? "保存中..." : isEdit ? "保存更改" : "创建绑定"}
                </Button>
              </div>
            </form>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
