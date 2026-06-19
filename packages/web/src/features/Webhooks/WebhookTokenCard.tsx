import { CardOverflowMenu, IconTag, MetricGrid, CardToggle } from "@clawbot/ui";
import {
  WebhookIcon,
  TrashIcon,
  RefreshIcon,
  KeyIcon,
  ActivityIcon,
  ClockIcon,
  LayersIcon,
  StackIcon,
} from "@clawbot/ui";
import type { AccountSummary } from "@clawbot/shared";
import type { WebhookTokenInfo } from "@/api/webhooks.js";
import { cn } from "@/lib/cn.js";
import { formatCount, formatDateTime } from "@/lib/format.js";

export interface WebhookTokenCardProps {
  token: WebhookTokenInfo;
  accounts: AccountSummary[];
  busy: boolean;
  onOpenTest: () => void;
  onOpenLogs: () => void;
  onToggle: () => void;
  onRotate: () => void;
  onDelete: () => void;
}

export function WebhookTokenCard(props: WebhookTokenCardProps) {
  const accountLabels = props.token.accountIds.map((id) => {
    const acct = props.accounts.find((a) => a.id === id);
    return acct?.alias || acct?.display_name || id.slice(0, 12);
  });

  return (
    <div className="reveal-up group relative rounded-lg border border-card-line bg-card-bg shadow-elevation transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover">
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg border transition",
            props.token.enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-600"
              : "border-line bg-slate-wash-soft text-muted",
          )}
        >
          <KeyIcon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-lg font-semibold tracking-title text-ink">
              {props.token.source}
            </span>
          </div>
          <p className="mt-0.5 truncate text-base text-muted">
            {props.token.description || "未填写描述"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-start">
          <CardToggle
            enabled={props.token.enabled}
            busy={props.busy}
            label={props.token.enabled ? "停用 Webhook Token" : "启用 Webhook Token"}
            onToggle={props.onToggle}
          />
          <CardOverflowMenu
            items={[
              {
                label: "测试发送",
                tone: "success",
                onClick: props.onOpenTest,
                icon: <ActivityIcon className="size-4" />,
              },
              {
                label: "查看日志",
                tone: "primary",
                onClick: props.onOpenLogs,
                icon: <WebhookIcon className="size-4" />,
              },
              {
                label: "轮换 Token",
                tone: "warning",
                onClick: props.onRotate,
                icon: <RefreshIcon className="size-4" />,
              },
              {
                label: "删除 Token",
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
              icon: <KeyIcon className="size-3.5" />,
              label: "Token",
              value: <span className="font-mono text-base">{props.token.tokenPrefix}...</span>,
            },
            {
              icon: <LayersIcon className="size-3.5" />,
              label: "授权账号",
              value: `${formatCount(props.token.accountIds.length)} 个`,
            },
            {
              icon: <ClockIcon className="size-3.5" />,
              label: "最近使用",
              value: props.token.lastUsedAt ? formatDateTime(props.token.lastUsedAt) : "从未使用",
            },
            {
              icon: <StackIcon className="size-3.5" />,
              label: "创建时间",
              value: formatDateTime(props.token.createdAt),
            },
          ]}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5 px-5 pb-4">
        {accountLabels.map((label, i) => (
          <IconTag key={props.token.accountIds[i]} icon={<WebhookIcon className="size-3" />}>
            {label}
          </IconTag>
        ))}
      </div>
    </div>
  );
}
