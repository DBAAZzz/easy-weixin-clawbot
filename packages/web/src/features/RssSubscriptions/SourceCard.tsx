import { Badge, CardOverflowMenu, CardToggle, MetricGrid } from "@clawbot/ui";
import { LinkIcon, PencilIcon, RefreshIcon, RssIcon, SearchIcon, TrashIcon } from "@clawbot/ui";
import type { RssSourceDto } from "@/api/rss.js";
import { formatDateTime, formatCount } from "../../lib/format.js";
import { sourceStatusTone, sourceStatusLabel } from "./types.js";

export function SourceCard(props: {
  source: RssSourceDto;
  onEdit: () => void;
  onPreview: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="reveal-up group relative rounded-lg border border-card-line bg-glass-90 pb-5 shadow-card-hover transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-accent-border-strong">
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-white/90 text-muted-strong">
            <RssIcon className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-lg font-semibold tracking-title text-ink">
                {props.source.name}
              </h3>
              <Badge tone={sourceStatusTone(props.source.status)}>
                {sourceStatusLabel(props.source.status)}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-base text-muted">
              {props.source.source_type === "rss_url"
                ? props.source.feed_url
                : props.source.route_path || "未配置路由"}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-center">
          <CardToggle
            enabled={props.source.enabled}
            label={props.source.enabled ? "停用订阅源" : "启用订阅源"}
            onToggle={props.onToggle}
          />
          <CardOverflowMenu
            items={[
              {
                label: "预览内容",
                tone: "primary",
                onClick: props.onPreview,
                icon: <SearchIcon className="size-4" />,
              },
              {
                label: "测试抓取",
                tone: "warning",
                onClick: props.onTest,
                icon: <RefreshIcon className="size-4" />,
              },
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

      {props.source.description ? (
        <p className="mt-3 px-5 text-base leading-6 text-muted-strong">
          {props.source.description}
        </p>
      ) : null}

      <div className="px-5">
        <MetricGrid
          items={[
            {
              icon: <RefreshIcon className="size-3.5" />,
              label: "最近抓取",
              value: formatDateTime(props.source.last_fetched_at),
            },
            {
              icon: <LinkIcon className="size-3.5" />,
              label: "任务引用",
              value: formatCount(props.source.referenced_task_count),
            },
          ]}
        />
      </div>

      {props.source.last_error ? (
        <div className="mt-3 mx-5 rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-sm leading-6 text-red-700">
          {props.source.last_error}
        </div>
      ) : null}
    </div>
  );
}
