import { useNavigate } from "react-router-dom";
import { LogOutIcon, SettingsIcon } from "@clawbot/ui";
import { cn } from "@/lib/cn.js";
import { SidebarActionIconButton } from "./SidebarActionIconButton.js";

interface SidebarFooterProps {
  collapsed: boolean;
}

export function SidebarFooter({ collapsed }: SidebarFooterProps) {
  const navigate = useNavigate();

  return (
    <div
      className={cn(
        "mt-auto flex items-center px-1 pt-4",
        collapsed ? "flex-col gap-1" : "justify-between",
      )}
    >
      <SidebarActionIconButton
        label="设置"
        icon={<SettingsIcon className="size-4" />}
        align="left"
        onClick={() => navigate("/settings/general")}
        showTooltip={!collapsed}
      />
      <SidebarActionIconButton
        label="退出登录"
        icon={<LogOutIcon className="size-4" />}
        align={collapsed ? "left" : "right"}
        showTooltip={!collapsed}
        onClick={() => {
          localStorage.removeItem("auth_token");
          navigate("/auth/login", { replace: true });
        }}
      />
    </div>
  );
}
