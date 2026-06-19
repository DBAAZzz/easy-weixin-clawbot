import type { ReactNode } from "react";
import { Badge } from "@clawbot/ui";

export function IconTag(props: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "online" | "offline" | "muted" | "error" | "warning";
}) {
  return (
    <Badge tone={props.tone ?? "muted"} className="gap-1.5 px-2.5 py-1.5 tracking-tag">
      <span className="inline-flex size-3 items-center justify-center opacity-75">
        {props.icon}
      </span>
      <span>{props.children}</span>
    </Badge>
  );
}
