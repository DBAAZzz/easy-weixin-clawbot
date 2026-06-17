import type { McpToolInfo } from "@clawbot/shared";
import { Badge, CardToggle, TerminalIcon } from "@clawbot/ui";

export function McpToolCard(props: {
  tool: McpToolInfo;
  busy: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <div className="flex min-h-[108px] items-center gap-3 rounded-lg border border-card-line bg-card-bg px-3.5 py-3.5 md:px-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-frost-92 text-ink">
        <TerminalIcon className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-md font-medium text-ink">{props.tool.remote_name}</h3>
          <Badge tone="muted">{props.tool.server_slug}</Badge>
        </div>
        <p
          className="mt-1 truncate font-mono text-xs leading-5 text-muted"
          title={props.tool.local_name}
        >
          {props.tool.local_name}
        </p>
        <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-muted-strong">
          {props.tool.summary ?? "该 tool 未提供描述。"}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <CardToggle
          enabled={props.tool.enabled}
          busy={props.busy}
          label={props.tool.enabled ? "停用 MCP 工具" : "启用 MCP 工具"}
          onToggle={props.onToggle}
        />
        <span className="text-2xs font-medium text-muted">
          {props.tool.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}
