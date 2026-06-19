import {
  ChevronLeftIcon,
  LinkIcon,
  SearchIcon,
  SlidersIcon,
  StackIcon,
} from "@clawbot/ui";
import { MenuSection } from "./MenuSection.js";
import { NavItem } from "./NavItem.js";
import type { SidebarNavProps } from "./sidebarVariants.js";

export function SettingsSidebarNav({ collapsed }: SidebarNavProps) {
  return (
    <MenuSection label="设置" collapsed={collapsed}>
      <NavItem
        to="/"
        label="返回控制台"
        icon={<ChevronLeftIcon className="size-4" />}
        collapsed={collapsed}
      />
      <NavItem
        to="/settings/general"
        label="通用"
        icon={<SlidersIcon className="size-4" />}
        collapsed={collapsed}
      />
      <NavItem
        to="/settings/rss"
        label="RSS"
        icon={<LinkIcon className="size-4" />}
        collapsed={collapsed}
      />
      <NavItem
        to="/settings/asset-storage"
        label="资产存储"
        icon={<StackIcon className="size-4" />}
        collapsed={collapsed}
      />
      <NavItem
        to="/settings/network-search"
        label="网络搜索"
        icon={<SearchIcon className="size-4" />}
        collapsed={collapsed}
      />
    </MenuSection>
  );
}
