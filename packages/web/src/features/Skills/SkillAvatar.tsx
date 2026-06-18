import type { SkillInfo } from "@clawbot/shared";
import { SkillIcon } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";

export function SkillAvatar(props: { origin: SkillInfo["origin"]; enabled?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-control border transition duration-200 ease-expo",
        props.enabled === false
          ? "border-account-line-strong bg-account-filter-track text-account-muted-faint"
          : props.origin === "builtin"
            ? "border-line bg-account-filter-track text-account-ink-soft"
            : "border-accent-border bg-accent-mist text-accent-strong",
      )}
    >
      <SkillIcon className="size-5" />
    </span>
  );
}
