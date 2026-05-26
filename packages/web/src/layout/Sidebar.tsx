import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { AccountSummary, HealthStatus } from "@clawbot/shared";
import type { ResizeHandleProps } from "@/hooks/useResizableWidth.js";
import { cn } from "@/lib/cn.js";
import {
  ClockIcon,
  CpuIcon,
  GaugeIcon,
  LayersIcon,
  LinkIcon,
  LogOutIcon,
  PulseIcon,
  PuzzleIcon,
  ScanIcon,
  SettingsIcon,
  RssIcon,
  StackIcon,
  TerminalIcon,
  WebhookIcon,
} from "../components/ui/icons.js";
import logoUrl from "../assets/images/logo.png";

function navClassName(isActive: boolean, collapsed: boolean) {
  return cn(
    "group flex items-center rounded-lg text-md transition duration-200 ease-expo",
    collapsed ? "size-10 justify-center px-0 py-0" : "gap-3 px-3 py-2.5",
    isActive
      ? "bg-accent-active font-semibold text-ink shadow-accent-xs"
      : "text-muted-strong hover:bg-white/72 hover:text-ink",
  );
}

interface NavItemProps {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
  badgeVariant?: "default" | "success" | "warning" | "danger";
  collapsed: boolean;
}

function NavItem({ to, label, icon, badge, badgeVariant = "default", collapsed }: NavItemProps) {
  const badgeStyles = {
    default: "bg-muted/15 text-muted-strong",
    success: "bg-emerald-500/15 text-emerald-600",
    warning: "bg-amber-500/15 text-amber-600",
    danger: "bg-rose-500/15 text-rose-600",
  };

  return (
    <NavLink
      to={to}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={({ isActive }) => navClassName(isActive, collapsed)}
    >
      <span className="text-muted-strong transition group-hover:text-ink">{icon}</span>
      <span className={cn("truncate", collapsed && "sr-only")}>{label}</span>
      {badge !== undefined && !collapsed && (
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-sm font-medium",
            badgeStyles[badgeVariant],
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

interface MenuSectionProps {
  label: string;
  children: ReactNode;
  collapsed: boolean;
}

function MenuSection({ label, children, collapsed }: MenuSectionProps) {
  return (
    <div className={cn(collapsed ? "mt-3 first:mt-3" : "mt-5 first:mt-4")}>
      {!collapsed && (
        <p className="px-3 text-xs font-medium uppercase tracking-label text-muted">{label}</p>
      )}
      <nav className={cn("grid gap-1", collapsed ? "justify-center" : "mt-2")}>{children}</nav>
    </div>
  );
}

interface SidebarActionIconButtonProps {
  label: string;
  icon: ReactNode;
  align: "left" | "right";
  onClick: () => void;
  showTooltip: boolean;
}

function SidebarActionIconButton({
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

export function Sidebar(props: {
  accounts: AccountSummary[];
  collapsed: boolean;
  health?: HealthStatus;
  healthLoading: boolean;
  maxWidth: number;
  minWidth: number;
  onOpenSettings: () => void;
  resizeHandleProps: ResizeHandleProps;
  resizing: boolean;
  width: number;
}) {
  const navigate = useNavigate();
  const activeCount = props.accounts.filter((account) => !account.deprecated).length;
  const isOnline = props.health && !props.healthLoading;

  return (
    <aside
      className="bg-sidebar-shell relative h-dvh shrink-0 overflow-hidden border-r border-line"
      style={{
        maxWidth: props.maxWidth,
        minWidth: props.minWidth,
        width: props.width,
      }}
    >
      <div
        className={cn(
          "flex h-full flex-col overflow-x-hidden overflow-y-auto py-2 transition-[padding] duration-200 ease-expo md:py-5",
          props.collapsed ? "px-2" : "px-3 md:px-4",
        )}
      >
        {/* Logo */}
        <div
          className={cn(
            "flex items-center rounded-section py-2.5",
            props.collapsed ? "justify-center px-0" : "gap-3 px-3",
          )}
        >
          <img
            src={logoUrl}
            alt="Clawbot"
            className="size-10 rounded-lg object-cover shadow-logo"
          />
          <div className={cn("min-w-0", props.collapsed && "sr-only")}>
            <p className="text-lg font-semibold text-ink">Clawbot</p>
            <p className="mt-0.5 text-sm text-muted">运营控制台</p>
          </div>
        </div>

        {/* 资源管理 */}
        <MenuSection label="资源管理" collapsed={props.collapsed}>
          <NavItem
            to="/"
            label="账号管理"
            icon={<LayersIcon className="size-4" />}
            badge={activeCount}
            badgeVariant={activeCount > 0 ? "success" : "default"}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/memory-graph"
            label="记忆图谱"
            icon={<PulseIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/mcp"
            label="MCP 服务"
            icon={<LinkIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/tools"
            label="工具列表"
            icon={<TerminalIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/skills"
            label="技能列表"
            icon={<PuzzleIcon className="size-4" />}
            collapsed={props.collapsed}
          />
        </MenuSection>

        {/* 控制策略 */}
        <MenuSection label="控制策略" collapsed={props.collapsed}>
          <NavItem
            to="/model-config"
            label="模型配置"
            icon={<CpuIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/rss-subscriptions"
            label="RSS订阅"
            icon={<RssIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/task-center"
            label="任务中心"
            icon={<StackIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/scheduled-tasks"
            label="Prompt任务"
            icon={<ClockIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/webhooks"
            label="回调配置"
            icon={<WebhookIcon className="size-4" />}
            collapsed={props.collapsed}
          />
        </MenuSection>

        {/* 运维中心 */}
        <MenuSection label="运维中心" collapsed={props.collapsed}>
          <NavItem
            to="/observability"
            label="运行监控"
            icon={<GaugeIcon className="size-4" />}
            collapsed={props.collapsed}
          />
          <NavItem
            to="/login"
            label="连接管理"
            icon={<ScanIcon className="size-4" />}
            badge={isOnline ? "在线" : "离线"}
            badgeVariant={isOnline ? "success" : "default"}
            collapsed={props.collapsed}
          />
        </MenuSection>

        <div
          className={cn(
            "mt-auto flex items-center px-1 pt-4",
            props.collapsed ? "flex-col gap-1" : "justify-between",
          )}
        >
          <SidebarActionIconButton
            label="设置"
            icon={<SettingsIcon className="size-4" />}
            align="left"
            onClick={props.onOpenSettings}
            showTooltip={!props.collapsed}
          />
          <SidebarActionIconButton
            label="退出登录"
            icon={<LogOutIcon className="size-4" />}
            align={props.collapsed ? "left" : "right"}
            showTooltip={!props.collapsed}
            onClick={() => {
              localStorage.removeItem("auth_token");
              navigate("/auth/login", { replace: true });
            }}
          />
        </div>
      </div>
      <button
        type="button"
        aria-label="调整侧边栏宽度"
        className={cn(
          "absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none bg-transparent transition duration-200 ease-expo hover:bg-accent-soft focus-visible:outline-none focus-visible:shadow-focus-accent",
          props.resizing && "bg-accent-soft",
        )}
        {...props.resizeHandleProps}
      />
    </aside>
  );
}
