import { useNavigate } from "react-router-dom";
import { LogOutIcon, SettingsIcon } from "@clawbot/ui";
import { useHealth } from "@/hooks/useHealth.js";
import { cn } from "@/lib/cn.js";
import { SidebarActionIconButton } from "./SidebarActionIconButton.js";

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const navigate = useNavigate();
  const { health } = useHealth();
  const demoMode = health?.demo_mode === true;

  return (
    <div className="flex shrink-0 flex-col gap-2 px-1 pt-4">
      {demoMode ? (
        collapsed ? (
          <span className="size-1.5 shrink-0 self-center rounded-full bg-accent" title="演示数据" />
        ) : (
          <span className="self-start rounded-pill bg-accent-mist px-2 py-0.5 text-xs font-medium text-accent-strong">
            演示数据
          </span>
        )
      ) : null}
      <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "justify-between")}>
        <SidebarActionIconButton
          label="设置"
          icon={<SettingsIcon className="size-4" />}
          placement="right"
          onClick={() => navigate("/settings/general")}
          showTooltip={collapsed}
        />
        <SidebarActionIconButton
          label="退出登录"
          icon={<LogOutIcon className="size-4" />}
          placement={collapsed ? "right" : "left"}
          showTooltip={collapsed}
          onClick={() => {
            localStorage.removeItem("auth_token");
            navigate("/auth/login", { replace: true });
          }}
        />
      </div>
    </div>
  );
}
