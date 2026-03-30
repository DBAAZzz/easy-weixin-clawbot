import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type { AccountSummary, HealthStatus } from "@clawbot/shared";
import { cn } from "../../lib/cn.js";
import { formatCount, formatDuration } from "../../lib/format.js";
import {
  ActivityIcon,
  HomeIcon,
  LinkIcon,
  PuzzleIcon,
  QueueIcon,
  ScanIcon,
  StackIcon,
  TerminalIcon,
} from "../ui/icons.js";

function navClassName(isActive: boolean) {
  return cn(
    "group flex items-center gap-3 rounded-[16px] px-3 py-2.5 text-[13px] transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
    isActive
      ? "bg-[rgba(21,110,99,0.1)] font-medium text-[var(--ink)]"
      : "text-[var(--muted-strong)] hover:bg-white/72 hover:text-[var(--ink)]"
  );
}

function SidebarStatusRow(props: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] px-3 py-2.5 text-[13px] text-[var(--muted-strong)] transition hover:bg-white/72">
      <div className="flex items-center gap-3">
        <span className="text-[var(--muted)]">{props.icon}</span>
        <span>{props.label}</span>
      </div>
      <span className="font-[var(--font-mono)] text-[12px] text-[var(--muted)]">{props.value}</span>
    </div>
  );
}

export function Sidebar(props: {
  accounts: AccountSummary[];
  health?: HealthStatus;
  healthLoading: boolean;
}) {
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
  const menuSections = [
    {
      label: "工作台",
      items: [
        { to: "/", label: "账号列表", icon: <HomeIcon className="size-4" /> },
        { to: "/mcp", label: "MCP Servers", icon: <LinkIcon className="size-4" /> },
        { to: "/tools", label: "工具列表", icon: <TerminalIcon className="size-4" /> },
        { to: "/skills", label: "技能列表", icon: <PuzzleIcon className="size-4" /> },
        { to: "/login", label: "连接 clawbot", icon: <ScanIcon className="size-4" /> },
      ],
    },
  ];

  return (
    <aside className="h-[100dvh] overflow-hidden border-r border-[var(--line)] bg-[linear-gradient(180deg,rgba(247,250,251,0.94),rgba(241,245,247,0.98))]">
      <div className="flex h-full flex-col overflow-y-auto px-3 py-4 md:px-4 md:py-5">
        <div className="flex items-center gap-3 rounded-[18px] px-3 py-2.5">
          <span className="flex size-10 items-center justify-center rounded-[14px] bg-[var(--ink)] text-white shadow-[0_16px_34px_-22px_rgba(15,23,42,0.45)]">
            <StackIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-[var(--ink)]">Clawbot</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">Operator Console</p>
          </div>
        </div>

        {menuSections.map((section) => (
          <div key={section.label} className="mt-4">
            <p className="px-3 text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
              {section.label}
            </p>
            <nav className="mt-2 grid gap-1">
              {section.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => navClassName(isActive)}>
                  <span className="text-[var(--muted-strong)] transition group-hover:text-[var(--ink)]">
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        ))}

        <div className="mt-4 border-t border-[var(--line)]" />

        <div className="mt-4 flex-1 px-1">
          <p className="px-2 text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">系统</p>
          <div className="mt-2 grid gap-1">
            <SidebarStatusRow
              label="活跃账号"
              value={formatCount(activeCount)}
              icon={<ActivityIcon className="size-4" />}
            />
            <SidebarStatusRow
              label="待写入"
              value={queueLabel}
              icon={<QueueIcon className="size-4" />}
            />
            <SidebarStatusRow
              label="运行时长"
              value={runtimeLabel}
              icon={<StackIcon className="size-4" />}
            />
          </div>

          <div className="mt-4 rounded-[16px] border border-dashed border-[var(--line)] bg-white/42 px-4 py-4 text-[13px] leading-6 text-[var(--muted)]">
            账号列表统一在“账号列表”页面查看，侧栏仅保留导航与系统状态。
          </div>
        </div>
      </div>
    </aside>
  );
}
