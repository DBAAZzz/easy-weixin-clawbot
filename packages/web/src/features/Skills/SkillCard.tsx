import type { SkillInfo } from "@clawbot/shared";
import { Badge, Card, CardToggle } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";
import { formatOriginLabel } from "./types.js";
import { SkillAvatar } from "./SkillAvatar.js";

export function SkillCard(props: {
  skill: SkillInfo;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void | Promise<void>;
}) {
  const originLabel = formatOriginLabel(props.skill.origin);
  const isAlwaysOn = props.skill.activation === "always";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`查看 ${props.skill.name} 详情`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className={cn(
        "reveal-up group flex min-h-44 cursor-pointer flex-col rounded-section border-account-line bg-account-card px-5 py-4 shadow-account-card backdrop-blur-none transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-account-control-hover hover:shadow-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent",
        !props.skill.enabled && "border-account-line-soft opacity-75",
      )}
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <div className="flex w-full items-start gap-3">
        <SkillAvatar origin={props.skill.origin} enabled={props.skill.enabled} />

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-base font-bold leading-tight tracking-body text-account-ink">
              {props.skill.name}
            </h3>
            <span className="shrink-0 font-mono text-xs font-semibold text-account-muted-faint">
              v{props.skill.version.replace(/^v/u, "")}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-account-muted-soft">
            {props.skill.author ?? originLabel}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          <CardToggle
            enabled={props.skill.enabled}
            busy={props.busy}
            label={props.skill.enabled ? "停用技能" : "启用技能"}
            onToggle={props.onToggle}
          />
        </div>
      </div>

      <p className="mt-3 line-clamp-2 min-h-10 w-full text-sm leading-5 text-account-muted">
        {props.skill.summary}
      </p>

      <div className="my-3 h-px w-full bg-account-line-soft" />

      <div className="flex w-full flex-wrap items-center gap-2">
        <Badge
          tone={isAlwaysOn ? "error" : "warning"}
          size="sm"
          className={cn(
            "gap-1.5 rounded-pill border-transparent px-2.5 py-1 text-xs font-semibold",
            isAlwaysOn
              ? "bg-notice-error-bg text-danger-strong"
              : "bg-notice-warning-bg text-account-warning-fg",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isAlwaysOn ? "bg-danger" : "bg-account-warning-dot",
            )}
          />
          {isAlwaysOn ? "常驻 Always-On" : "按需 On-Demand"}
        </Badge>
        <Badge
          tone="muted"
          size="sm"
          className="rounded-pill border-transparent bg-account-filter-track px-2.5 py-1 text-xs font-semibold text-account-muted"
        >
          {originLabel}
        </Badge>
        <span className="flex-1" />
        <span
          className={cn(
            "text-sm font-semibold",
            props.skill.enabled ? "text-account-success-fg" : "text-account-muted-faint",
          )}
        >
          {props.skill.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </Card>
  );
}
