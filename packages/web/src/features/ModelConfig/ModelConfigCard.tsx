import type { ModelConfigDto } from "@clawbot/shared";
import {
  Card,
  CardOverflowMenu,
  CardToggle,
  ChatIcon,
  CpuIcon,
  IconTag,
  LayersIcon,
  LinkIcon,
  MetricGrid,
  PencilIcon,
  TrashIcon,
} from "@clawbot/ui";
import { ProviderBrandIcon } from "../ProviderConfig/providerBrandIcon.js";
import { cn } from "@/lib/cn.js";
import { getPingMeta, PingStatusButton } from "./PingStatusButton.js";
import { SCOPE_LABELS, PURPOSE_LABELS, SCOPE_TONES, VISION_OVERRIDE_LABELS } from "./types.js";
import type { ProviderPingState } from "./types.js";

export function ModelConfigCard(props: {
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
    <Card className="reveal-up group relative overflow-hidden !p-0 border-card-line bg-glass-90 shadow-card-hover transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-accent-border-strong">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-card border",
            config.template_enabled
              ? "border-notice-success-border bg-notice-success-bg text-accent-strong"
              : "border-notice-warning-border bg-notice-warning-bg text-notice-warning-fg",
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
        <MetricGrid
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
        {config.supports_image_input_override !== "default" ? (
          <IconTag icon={<CpuIcon className="size-3" />} tone="warning">
            {VISION_OVERRIDE_LABELS[config.supports_image_input_override]}
          </IconTag>
        ) : null}
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
    </Card>
  );
}
