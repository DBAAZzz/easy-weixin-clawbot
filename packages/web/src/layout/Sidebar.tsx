import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import type { AccountSummary, HealthStatus } from "@clawbot/shared";
import { cn } from "../lib/cn.js";
import { formatCount, formatDuration } from "../lib/format.js";
import {
  ActivityIcon,
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
  SlidersIcon,
  TerminalIcon,
  WebhookIcon,
} from "../components/ui/icons.js";
import logoUrl from "../assets/images/logo.png";

function navClassName(isActive: boolean) {
  return cn(
    "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-md transition duration-200 ease-expo",
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
}

function NavItem({ to, label, icon, badge, badgeVariant = "default" }: NavItemProps) {
  const badgeStyles = {
    default: "bg-muted/15 text-muted-strong",
    success: "bg-emerald-500/15 text-emerald-600",
    warning: "bg-amber-500/15 text-amber-600",
    danger: "bg-rose-500/15 text-rose-600",
  };

  return (
    <NavLink to={to} className={({ isActive }) => navClassName(isActive)}>
      <span className="text-muted-strong transition group-hover:text-ink">{icon}</span>
      <span className="truncate">{label}</span>
      {badge !== undefined && (
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
}

function MenuSection({ label, children }: MenuSectionProps) {
  return (
    <div className="mt-5 first:mt-4">
      <p className="px-3 text-xs font-medium uppercase tracking-label text-muted">{label}</p>
      <nav className="mt-2 grid gap-1">{children}</nav>
    </div>
  );
}

export function Sidebar(props: {
  accounts: AccountSummary[];
  health?: HealthStatus;
  healthLoading: boolean;
}) {
  const navigate = useNavigate();
  const activeCount = props.accounts.filter((account) => !account.deprecated).length;

  const runtimeLabel = props.healthLoading
    ? "读取中"
    : props.health
      ? formatDuration(props.health.uptime_ms)
      : "--";

  const queueLabel = props.healthLoading
    ? "读取中"
    : props.health
      ? formatCount(props.health.pending_message_writes)
      : "--";

  const traceQueueLabel = props.healthLoading
    ? "读取中"
    : props.health
      ? formatCount(props.health.pending_trace_writes)
      : "--";

  const isOnline = props.health && !props.healthLoading;

  return (
    <aside className="bg-sidebar-shell h-dvh overflow-hidden border-r border-line">
      <div className="flex h-full flex-col overflow-y-auto px-3 py-4 md:px-4 md:py-5">
        {/* Logo */}
        <div className="flex items-center gap-3 rounded-section px-3 py-2.5">
          <img
            src={logoUrl}
            alt="Clawbot"
            className="size-10 rounded-lg object-cover shadow-logo"
          />
          <div className="min-w-0">
            <p className="text-lg font-semibold text-ink">Clawbot</p>
            <p className="mt-0.5 text-sm text-muted">运营控制台</p>
          </div>
        </div>

        {/* 资源管理 */}
        <MenuSection label="资源管理">
          <NavItem
            to="/"
            label="账号管理"
            icon={<LayersIcon className="size-4" />}
            badge={activeCount}
            badgeVariant={activeCount > 0 ? "success" : "default"}
          />
          <NavItem to="/memory-graph" label="记忆图谱" icon={<PulseIcon className="size-4" />} />
          <NavItem to="/mcp" label="MCP 服务" icon={<LinkIcon className="size-4" />} />
          <NavItem to="/tools" label="工具列表" icon={<TerminalIcon className="size-4" />} />
          <NavItem to="/skills" label="技能列表" icon={<PuzzleIcon className="size-4" />} />
        </MenuSection>

        {/* 控制策略 */}
        <MenuSection label="控制策略">
          <NavItem to="/model-config" label="模型配置" icon={<CpuIcon className="size-4" />} />
          <NavItem to="/scheduled-tasks" label="定时任务" icon={<ClockIcon className="size-4" />} />
          <NavItem to="/webhooks" label="回调配置" icon={<WebhookIcon className="size-4" />} />
        </MenuSection>

        {/* 运维中心 */}
        <MenuSection label="运维中心">
          <NavItem to="/observability" label="运行监控" icon={<GaugeIcon className="size-4" />} />
          <NavItem
            to="/login"
            label="连接管理"
            icon={<ScanIcon className="size-4" />}
            badge={isOnline ? "在线" : "离线"}
            badgeVariant={isOnline ? "success" : "default"}
          />
        </MenuSection>

        {/* 系统状态卡片 */}
        <div className="mt-5 border-t border-line pt-4">
          <p className="px-3 text-xs font-medium uppercase tracking-label text-muted">系统状态</p>
          <div className="mt-3 rounded-lg border border-line bg-white/60 p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-panel bg-white/80 px-3 py-2">
                <p className="text-xs text-muted">运行时长</p>
                <p className="mt-0.5 text-base font-medium text-ink">{runtimeLabel}</p>
              </div>
              <div className="rounded-panel bg-white/80 px-3 py-2">
                <p className="text-xs text-muted">待写入队列</p>
                <p className="mt-0.5 text-base font-medium text-ink">{queueLabel}</p>
              </div>
              <div className="col-span-2 rounded-panel bg-white/80 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ActivityIcon className="size-3.5 text-muted" />
                    <span className="text-xs text-muted">Trace 队列</span>
                  </div>
                  <span className="text-base font-medium text-ink">{traceQueueLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 退出登录 */}
        <div className="mt-auto px-1 pt-4">
          <button
            onClick={() => {
              localStorage.removeItem("auth_token");
              navigate("/auth/login", { replace: true });
            }}
            className="flex w-full items-center gap-3 rounded-lg border border-line bg-white/55 px-3 py-2.5 text-md text-muted-strong transition duration-200 ease-expo hover:bg-white/72 hover:text-ink"
          >
            <LogOutIcon className="size-4" />
            <span>退出登录</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
