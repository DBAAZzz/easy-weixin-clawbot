import type { ReactNode } from "react";
import { cn } from "@/lib/cn.js";

interface SidebarActionIconButtonProps {
  label: string;
  icon: ReactNode;
  align: "left" | "right";
  onClick: () => void;
  showTooltip: boolean;
}

export function SidebarActionIconButton({
  label,
  icon,
  align,
  onClick,
  showTooltip,
}: SidebarActionIconButtonProps) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className="flex size-10 items-center justify-center rounded-card bg-transparent text-muted-strong transition duration-200 ease-expo hover:bg-white/72 hover:text-ink focus-visible:outline-none focus-visible:shadow-focus-accent active:translate-y-px"
      >
        {icon}
      </button>

      {showTooltip && (
        <span
          className={cn(
            "pointer-events-none absolute bottom-full mb-2 inline-flex rounded-pill border border-line bg-tooltip-value px-2.5 py-1 text-sm font-medium whitespace-nowrap text-ink opacity-0 shadow-popover transition duration-200 ease-expo group-hover:opacity-100 group-focus-within:opacity-100",
            align === "left" ? "left-0" : "right-0",
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}
