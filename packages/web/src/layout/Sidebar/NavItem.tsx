import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Tooltip } from "@clawbot/ui";
import { cn } from "@/lib/cn.js";
import { navClassName } from "./navClassName.js";

export type NavBadgeVariant = "default" | "success" | "warning" | "danger";

interface NavItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
  badgeVariant?: NavBadgeVariant;
  collapsed: boolean;
}

const badgeStyles: Record<NavBadgeVariant, string> = {
  default: "bg-muted/15 text-muted-strong",
  success: "bg-emerald-500/15 text-emerald-600",
  warning: "bg-amber-500/15 text-amber-600",
  danger: "bg-rose-500/15 text-rose-600",
};

export function NavItem({
  to,
  label,
  icon,
  badge,
  badgeVariant = "default",
  collapsed,
}: NavItemProps) {
  const link = (
    <NavLink
      to={to}
      aria-label={collapsed ? label : undefined}
      className={({ isActive }) => navClassName(isActive, collapsed)}
      viewTransition
    >
      <span className="text-muted-strong transition group-hover:text-ink">{icon}</span>
      <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
      {badge !== undefined && !collapsed && (
        <span
          className={cn(
            "ml-auto rounded-full shrink-0 px-2 py-0.5 text-sm font-medium",
            badgeStyles[badgeVariant],
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip title={label} placement="right">
        {link}
      </Tooltip>
    );
  }

  return link;
}
