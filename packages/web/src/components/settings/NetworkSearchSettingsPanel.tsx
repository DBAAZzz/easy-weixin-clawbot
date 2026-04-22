import { useEffect, useMemo, useState } from "react";
import type { WebSearchProviderDto } from "@clawbot/shared";
import { CardToggle } from "../ui/admin-card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NetworkIcon, SearchIcon } from "../ui/icons.js";
import { toast } from "../ui/sonner.js";
import { cn } from "../../lib/cn.js";
import { useWebSearchProviders } from "../../hooks/useWebSearchProviders.js";

type WebSearchDraft = {
  enabled: boolean;
  apiKey: string;
  apiKeySet: boolean;
};

const NETWORK_SEARCH_PROVIDER_ORDER = ["brave", "tavily"] as const;

const PROVIDER_META: Record<
  (typeof NETWORK_SEARCH_PROVIDER_ORDER)[number],
  {
    label: string;
    inputPlaceholder: string;
    icon: typeof SearchIcon;
  }
> = {
  brave: {
    label: "Brave Search",
    inputPlaceholder: "请输入 Brave API Key",
    icon: SearchIcon,
  },
  tavily: {
    label: "Tavily Search",
    inputPlaceholder: "请输入 Tavily API Key",
    icon: NetworkIcon,
  },
};

function createDraft(provider: WebSearchProviderDto | null): WebSearchDraft {
  return {
    enabled: provider?.enabled ?? false,
    apiKey: "",
    apiKeySet: provider?.api_key_set ?? false,
  };
}

function createDraftState(
  providers: WebSearchProviderDto[],
): Record<(typeof NETWORK_SEARCH_PROVIDER_ORDER)[number], WebSearchDraft> {
  const byType = new Map(providers.map((provider) => [provider.provider_type, provider]));

  return {
    brave: createDraft(byType.get("brave") ?? null),
    tavily: createDraft(byType.get("tavily") ?? null),
  };
}

function hasExistingProvider(
  providers: WebSearchProviderDto[],
  providerType: WebSearchProviderDto["provider_type"],
): WebSearchProviderDto | null {
  return providers.find((provider) => provider.provider_type === providerType) ?? null;
}

export function NetworkSearchSettingsPanel(props: { active: boolean }) {
  const [drafts, setDrafts] = useState<
    Record<(typeof NETWORK_SEARCH_PROVIDER_ORDER)[number], WebSearchDraft>
  >(() => createDraftState([]));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { providers, loading, error, create, update, refresh } = useWebSearchProviders(
    props.active,
  );

  useEffect(() => {
    if (!props.active) {
      return;
    }

    setSaveError(null);
    setDrafts(createDraftState(providers));
  }, [props.active, providers]);

  const configuredCount = useMemo(
    () => providers.filter((provider) => provider.api_key_set).length,
    [providers],
  );

  function updateDraft(
    providerType: WebSearchProviderDto["provider_type"],
    recipe: (current: WebSearchDraft) => WebSearchDraft,
  ) {
    setDrafts((current) => ({
      ...current,
      [providerType]: recipe(current[providerType]),
    }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);

    try {
      for (const providerType of NETWORK_SEARCH_PROVIDER_ORDER) {
        const draft = drafts[providerType];
        const current = hasExistingProvider(providers, providerType);
        const apiKey = draft.apiKey.trim();

        if (!current) {
          if (!apiKey) {
            if (draft.enabled) {
              throw new Error(`${PROVIDER_META[providerType].label} 已启用，请先填写 API Key`);
            }
            continue;
          }

          await create({
            provider_type: providerType,
            api_key: apiKey,
            enabled: draft.enabled,
          });
          continue;
        }

        const payload: { api_key?: string; enabled?: boolean } = {};
        if (apiKey) {
          payload.api_key = apiKey;
        }
        if (draft.enabled !== current.enabled) {
          payload.enabled = draft.enabled;
        }
        if (!payload.api_key && payload.enabled === undefined) {
          continue;
        }

        await update(providerType, payload);
      }

      await refresh();
      toast.success("网络搜索设置已保存");
    } catch (saveIssue) {
      const message = saveIssue instanceof Error ? saveIssue.message : "保存失败";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={cn("flex h-full min-w-0 flex-col", !props.active && "hidden")}>
      <header className="border-b border-line px-5 py-4 md:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-2xl font-semibold text-ink">网络搜索</h3>
            <p className="text-base leading-6 text-muted-strong">填写 API Key 并启用后生效。</p>
          </div>

          <Badge tone={configuredCount > 0 ? "online" : "offline"}>
            已配置 {configuredCount} / {NETWORK_SEARCH_PROVIDER_ORDER.length}
          </Badge>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6">
        <div className="flex flex-col gap-4">
          {error ? (
            <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
              加载网络搜索配置失败：{error}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-panel border border-line bg-pane-74 px-4 py-3 text-base text-muted-strong">
              正在加载网络搜索配置…
            </div>
          ) : null}

          {NETWORK_SEARCH_PROVIDER_ORDER.map((providerType) => {
            const draft = drafts[providerType];
            const meta = PROVIDER_META[providerType];
            const Icon = meta.icon;
            const inputId = `${providerType}-api-key`;

            return (
              <section
                key={providerType}
                className="rounded-panel border border-line bg-panel px-4 py-4 shadow-card md:px-5 md:py-5"
              >
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-card border border-line bg-pane-95 text-accent shadow-btn-soft">
                        <Icon className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-1">
                        <h4 className="text-2xl font-semibold text-ink">{meta.label}</h4>
                        <Badge tone={draft.apiKeySet ? "online" : "offline"} className="w-fit">
                          {draft.apiKeySet ? "已配置" : "未配置"}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end lg:self-start">
                      <span className="text-sm text-muted-strong">
                        {draft.enabled ? "已启用" : "已停用"}
                      </span>
                      <CardToggle
                        enabled={draft.enabled}
                        label={draft.enabled ? `停用 ${meta.label}` : `启用 ${meta.label}`}
                        onToggle={() =>
                          updateDraft(providerType, (current) => ({
                            ...current,
                            enabled: !current.enabled,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <label htmlFor={inputId} className="text-base font-medium text-muted-strong">
                      API Key
                    </label>
                    <Input
                      id={inputId}
                      type="password"
                      value={draft.apiKey}
                      onChange={(event) =>
                        updateDraft(providerType, (current) => ({
                          ...current,
                          apiKey: event.target.value,
                        }))
                      }
                      placeholder={draft.apiKeySet ? "已设置，留空则不修改" : meta.inputPlaceholder}
                      className="rounded-control"
                    />
                  </div>
                </div>
              </section>
            );
          })}

          {saveError ? (
            <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
              {saveError}
            </div>
          ) : null}

          <div className="flex justify-end pt-2">
            <Button disabled={saving || loading} onClick={() => void handleSave()}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
