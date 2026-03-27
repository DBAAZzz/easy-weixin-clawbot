import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "online" | "offline" | "muted";
};

export function Badge({ children, className, tone = "muted", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.12em]",
        tone === "online" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "offline" && "border-slate-200 bg-slate-100 text-slate-600",
        tone === "muted" && "border-[var(--line)] bg-white/60 text-[var(--muted-strong)]",
        className
      )}
      {...props}
    >
      {tone !== "muted" ? (
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "online" && "bg-emerald-500 status-dot",
            tone === "offline" && "bg-slate-400"
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
