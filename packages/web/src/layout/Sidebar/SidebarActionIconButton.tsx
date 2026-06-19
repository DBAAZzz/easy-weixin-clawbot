import type { ReactNode } from "react";
import { Tooltip } from "@clawbot/ui";
import type { TooltipPlacement } from "@clawbot/ui";

interface SidebarActionIconButtonProps {
  label: string;
  icon: ReactNode;
  placement: TooltipPlacement;
  onClick: () => void;
  showTooltip: boolean;
}

export function SidebarActionIconButton({
  label,
  icon,
  placement,
  onClick,
  showTooltip,
}: SidebarActionIconButtonProps) {
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-10 items-center justify-center rounded-card bg-transparent text-muted-strong transition duration-200 ease-expo hover:bg-white/72 hover:text-ink focus-visible:outline-none focus-visible:shadow-focus-accent active:translate-y-px"
    >
      {icon}
    </button>
  );

  if (showTooltip) {
    return (
      <Tooltip title={label} placement={placement}>
        {button}
      </Tooltip>
    );
  }

  return button;
}
