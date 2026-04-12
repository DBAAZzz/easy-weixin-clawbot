import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "online" | "offline" | "muted" | "error" | "warning";
};

export function Badge({ children, className, tone = "muted", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.12em]",
        tone === "online" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "offline" && "border-slate-200 bg-slate-100 text-slate-600",
        tone === "muted" && "border-[var(--line)] bg-white/60 text-[var(--muted-strong)]",
        tone === "error" && "border-red-200 bg-red-50 text-red-700",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-700",
        className,
      )}
      {...props}
    >
      {tone === "online" || tone === "offline" ? (
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "online" && "bg-emerald-500 status-dot",
            tone === "offline" && "bg-slate-400",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
