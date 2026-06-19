import { PanelLeftCloseIcon, PanelLeftOpenIcon, Button } from "@clawbot/ui";
import { cn } from "@/lib/cn.js";
import logoUrl from "@/assets/images/logo.png";

interface SidebarLogoProps {
  collapsed: boolean;
  hideBrandText: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}

export function SidebarLogo({ collapsed, hideBrandText, onCollapse, onExpand }: SidebarLogoProps) {
  return (
    <div
      className={cn(
        "flex rounded-section py-2.5",
        collapsed ? "flex-col items-center gap-2 px-0" : "items-center gap-3 px-3",
      )}
    >
      {collapsed && (
        <Button
          type="button"
          size="sm"
          aria-label="展开侧边栏"
          title="展开侧边栏"
          variant="ghost"
          onClick={onExpand}
        >
          <PanelLeftCloseIcon className="!size-5" />
        </Button>
      )}
      <img src={logoUrl} alt="Clawbot" className="size-10 rounded-lg object-cover shadow-logo" />
      {!collapsed && (
        <>
          <div className={cn("min-w-0", hideBrandText && "sr-only")}>
            <p className="text-lg font-semibold text-ink">Clawbot</p>
            <p className="mt-0.5 text-sm text-muted">运营控制台</p>
          </div>
          <Button
            type="button"
            size="sm"
            aria-label="收起侧边栏"
            title="收起侧边栏"
            variant="ghost"
            onClick={onCollapse}
            className="ml-auto"
          >
            <PanelLeftOpenIcon className="!size-5" />
          </Button>
        </>
      )}
    </div>
  );
}
