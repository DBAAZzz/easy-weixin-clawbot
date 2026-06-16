import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn.js";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "online" | "offline" | "muted" | "error" | "warning";
};

export function Badge({ children, className, tone = "muted", ...props }: BadgeProps) {
  return (
    <span className={cn("cb-badge", `cb-badge--${tone}`, className)} {...props}>
      {tone === "online" || tone === "offline" ? (
        <span
          className={cn(
            "cb-badge-dot",
            tone === "online" && "cb-badge-dot--online status-dot",
            tone === "offline" && "cb-badge-dot--offline",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
