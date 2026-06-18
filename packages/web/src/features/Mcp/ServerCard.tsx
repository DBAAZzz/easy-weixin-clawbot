import type { McpServerInfo } from "@clawbot/shared";
import { Badge, CardToggle, SkillIcon, TerminalIcon } from "@clawbot/ui";
import { cn } from "@/lib/cn.js";
import { formatCount, formatRelativeTime } from "@/lib/format.js";
import { statusLabel, statusTone } from "./types.js";

export function ServerCard(props: {
  server: McpServerInfo;
  index: number;
  busy: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`查看 ${props.server.name} 详情`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className={cn(
        "reveal-up group flex min-h-[120px] cursor-pointer items-center gap-3 rounded-lg border bg-card-bg px-3.5 py-3.5 transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent md:px-4",
        props.selected
          ? "border-accent-selected ring-2 ring-accent-selected-ring"
          : "border-card-line",
      )}
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-title text-ink">{props.server.name}</h3>
          <Badge tone={statusTone(props.server.status)}>{statusLabel(props.server.status)}</Badge>
          <Badge tone="muted">{props.server.slug}</Badge>
        </div>

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">
          {props.server.command}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-0.5">
            <TerminalIcon className="size-3" />
            {props.server.transport}
          </span>
          <span className="size-1 rounded-full bg-line-strong" />
          <span className="inline-flex items-center gap-0.5">
            <SkillIcon className="size-3" />
            tools {formatCount(props.server.tool_count)}
          </span>
          <span className="size-1 rounded-full bg-line-strong" />
          <span>{formatRelativeTime(props.server.last_seen_at)}</span>
        </div>

        {props.server.last_error ? (
          <p className="mt-2 line-clamp-2 text-sm leading-5 text-red-600">
            {props.server.last_error}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <CardToggle
          enabled={props.server.enabled}
          busy={props.busy}
          label={props.server.enabled ? "停用 MCP 服务" : "启用 MCP 服务"}
          onToggle={props.onToggle}
        />
        <span className="text-2xs font-medium text-muted">
          {props.server.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}
