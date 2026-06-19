import type { ReactNode } from "react";
import { cn } from "@/lib/cn.js";

interface MenuSectionProps {
  label: string;
  children: ReactNode;
  collapsed: boolean;
}

export function MenuSection({ label, children, collapsed }: MenuSectionProps) {
  return (
    <div className={cn(collapsed ? "mt-3 first:mt-3" : "mt-5 first:mt-4")}>
      {!collapsed && (
        <p className="px-3 text-xs font-medium uppercase tracking-label text-muted">{label}</p>
      )}
      <nav className={cn("grid gap-1", collapsed ? "justify-center" : "mt-2")}>{children}</nav>
    </div>
  );
}
