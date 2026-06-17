import type { SkillInfo } from "@clawbot/shared";
import { Badge, CardToggle } from "@clawbot/ui";
import { formatActivationLabel, formatOriginLabel } from "./types.js";
import { SkillAvatar } from "./SkillAvatar.js";

export function SkillCard(props: {
  skill: SkillInfo;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void | Promise<void>;
}) {
  const metadata = [
    `版本 ${props.skill.version}`,
    formatActivationLabel(props.skill.activation),
    formatOriginLabel(props.skill.origin),
  ];

  return (
    <div
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
      className="reveal-up group flex min-h-[108px] cursor-pointer items-center gap-3 rounded-lg border border-card-line bg-card-bg px-3.5 py-3.5 transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent md:px-4"
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <SkillAvatar origin={props.skill.origin} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-title text-ink">{props.skill.name}</h3>
          <Badge
            tone="muted"
            className="border-transparent bg-accent-mist px-2 py-1 text-2xs tracking-tag text-accent-strong"
          >
            {formatActivationLabel(props.skill.activation)}
          </Badge>
        </div>

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">{props.skill.summary}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {metadata.map((item, index) => (
            <span key={item} className="flex items-center gap-2">
              {index > 0 ? <span className="size-1 rounded-full bg-line-strong" /> : null}
              <span>{item}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <CardToggle
          enabled={props.skill.enabled}
          busy={props.busy}
          label={props.skill.enabled ? "停用技能" : "启用技能"}
          onToggle={props.onToggle}
        />
        <span className="text-xs font-medium text-muted">
          {props.skill.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}
