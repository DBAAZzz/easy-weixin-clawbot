import {
  ClockIcon,
  CpuIcon,
  GaugeIcon,
  LayersIcon,
  McpServerIcon,
  MemoryIcon,
  SkillIcon,
  ScanIcon,
  RssIcon,
  CheckListIcon,
  ToolsIcon,
  WebhookIcon,
} from "@clawbot/ui";
import { useAccounts } from "@/hooks/useAccounts.js";
import { useHealth } from "@/hooks/useHealth.js";
import { MenuSection } from "./MenuSection.js";
import { NavItem } from "./NavItem.js";
import type { SidebarNavProps } from "./sidebarVariants.js";

export function DefaultSidebarNav({ collapsed }: SidebarNavProps) {
  const { accounts } = useAccounts();
  const { health, loading: healthLoading } = useHealth();
  const activeCount = accounts.filter((account) => !account.deprecated).length;
  const isOnline = Boolean(health) && !healthLoading;

  return (
    <>
      {/* 资源管理 */}
      <MenuSection label="资源管理" collapsed={collapsed}>
        <NavItem
          to="/"
          label="账号管理"
          icon={<LayersIcon className="size-4" />}
          badge={activeCount}
          badgeVariant={activeCount > 0 ? "success" : "default"}
          collapsed={collapsed}
        />
        <NavItem
          to="/memory-graph"
          label="记忆图谱"
          icon={<MemoryIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/mcp"
          label="MCP 服务"
          icon={<McpServerIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/tools"
          label="工具列表"
          icon={<ToolsIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/skills"
          label="技能列表"
          icon={<SkillIcon className="size-4" />}
          collapsed={collapsed}
        />
      </MenuSection>

      {/* 控制策略 */}
      <MenuSection label="控制策略" collapsed={collapsed}>
        <NavItem
          to="/model-config"
          label="模型配置"
          icon={<CpuIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/rss-subscriptions"
          label="RSS订阅"
          icon={<RssIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/task-center"
          label="任务中心"
          icon={<CheckListIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/scheduled-tasks"
          label="Prompt任务"
          icon={<ClockIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/webhooks"
          label="回调配置"
          icon={<WebhookIcon className="size-4" />}
          collapsed={collapsed}
        />
      </MenuSection>

      {/* 运维中心 */}
      <MenuSection label="运维中心" collapsed={collapsed}>
        <NavItem
          to="/observability"
          label="运行监控"
          icon={<GaugeIcon className="size-4" />}
          collapsed={collapsed}
        />
        <NavItem
          to="/login"
          label="连接管理"
          icon={<ScanIcon className="size-4" />}
          badge={isOnline ? "在线" : "离线"}
          badgeVariant={isOnline ? "success" : "default"}
          collapsed={collapsed}
        />
      </MenuSection>
    </>
  );
}
