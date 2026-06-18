import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn.js";

export type BadgeTone = "online" | "offline" | "muted" | "error" | "warning";
export type BadgeSize = "sm" | "md";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  bordered?: boolean;
  showDot?: boolean;
  size?: BadgeSize;
  tone?: BadgeTone;
};

export function Badge({
  bordered = true,
  children,
  className,
  showDot = true,
  size = "md",
  tone = "muted",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "cb-badge",
        `cb-badge--${size}`,
        `cb-badge--${tone}`,
        !bordered && "cb-badge--borderless",
        className,
      )}
      {...props}
    >
      {showDot && (tone === "online" || tone === "offline") ? (
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
