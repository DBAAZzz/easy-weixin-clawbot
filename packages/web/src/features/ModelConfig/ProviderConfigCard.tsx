import type { ModelProviderTemplateDto } from "@clawbot/shared";
import {
  Card,
  CardOverflowMenu,
  CardToggle,
  LinkIcon,
  MetricGrid,
  PencilIcon,
  BlockchainIcon,
  TrashIcon,
} from "@clawbot/ui";
import { ProviderBrandIcon } from "../ProviderConfig/providerBrandIcon.js";
import { cn } from "@/lib/cn.js";
import { formatCount } from "../../lib/format.js";
import { getPingMeta, PingStatusButton } from "./PingStatusButton.js";
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
    <Card className="reveal-up group relative overflow-hidden border-card-line bg-glass-90 shadow-card-hover transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-accent-border-strong">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-card border",
            template.enabled
              ? "border-notice-success-border bg-notice-success-bg text-accent-strong"
              : "border-line bg-pane-90 text-muted-strong",
          )}
        >
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

      <MetricGrid
        items={[
          {
            icon: <BlockchainIcon className="size-3" />,
            label: "模型数",
            value: formatCount(template.model_ids.length),
          },
          {
            icon: <LinkIcon className="size-3" />,
            label: "引用数",
            value: formatCount(template.usage_count),
          },
        ]}
      />

      {getPingMeta(props.pingState) ? (
        <p className="mt-2 text-sm text-success-soft-fg">{getPingMeta(props.pingState)}</p>
      ) : null}
    </Card>
  );
}
