import type { SkillInfo } from "@clawbot/shared";
import { SkillIcon } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";

export function SkillAvatar(props: { origin: SkillInfo["origin"] }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-frost-92",
        props.origin === "builtin"
          ? "border-line text-ink"
          : "border-accent-border text-accent-strong",
      )}
    >
      <SkillIcon className="size-[18px]" />
    </span>
  );
}
