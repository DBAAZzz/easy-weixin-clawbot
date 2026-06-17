import type { ToolInfo } from "@clawbot/shared";
import { Badge } from "@clawbot/ui";
import { ToolAvatar } from "./ToolAvatar.js";
import { ParameterChip } from "./ParameterChip.js";
import { formatOriginLabel } from "./types.js";

export function ToolCard(props: { tool: ToolInfo; index: number; onOpen: () => void }) {
  const metadata = [props.tool.handler, formatOriginLabel(props.tool.origin)];
  const previewParameters = props.tool.parameterNames.slice(0, 3);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`查看 ${props.tool.name} 详情`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className="reveal-up group flex min-h-[108px] cursor-pointer items-center gap-3 rounded-lg border border-card-line bg-card-bg px-3.5 py-3.5 transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent md:px-4"
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <ToolAvatar origin={props.tool.origin} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-title text-ink">{props.tool.name}</h3>
          <Badge
            tone="muted"
            className="border-transparent bg-accent-mist px-2 py-1 text-2xs tracking-tag text-accent-strong"
          >
            {props.tool.handler}
          </Badge>
        </div>

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">
          {props.tool.description}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {metadata.map((item, index) => (
            <span key={item} className="flex items-center gap-2">
              {index > 0 ? <span className="size-1 rounded-full bg-line-strong" /> : null}
              <span>{item}</span>
            </span>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {previewParameters.length > 0 ? (
            previewParameters.map((name) => <ParameterChip key={name} name={name} />)
          ) : (
            <span className="text-xs text-muted">无参数</span>
          )}
          {props.tool.parameterNames.length > previewParameters.length ? (
            <span className="text-xs text-muted">
              +{props.tool.parameterNames.length - previewParameters.length} more
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Badge tone="online">代码内置</Badge>
        <span className="text-xs font-medium text-muted">始终启用</span>
      </div>
    </div>
  );
}
