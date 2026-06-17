import type { ModelProviderTemplateDto } from "../../../../shared/src/types.js";
import {
  CardOverflowMenu,
  CardToggle,
  LinkIcon,
  PencilIcon,
  StackIcon,
  TrashIcon,
} from "@clawbot/ui";
import { ProviderBrandIcon } from "../model-config/providerBrandIcon.js";
import { formatCount } from "../../lib/format.js";
import { getPingMeta, PingStatusButton } from "./PingStatusButton.js";
import { IconTag } from "./IconTag.js";
import { MetricPanel } from "./MetricPanel.js";
import type { ProviderPingState } from "./types.js";

export function ProviderConfigCard(props: {
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
