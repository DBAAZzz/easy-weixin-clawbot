import { useLocation } from "react-router-dom";
import type { ResizeHandleProps } from "@/hooks/useResizableWidth.js";
import { cn } from "@/lib/cn.js";
import { SidebarFooter } from "./SidebarFooter.js";
import { SidebarLogo } from "./SidebarLogo.js";
import { resolveSidebarNav } from "./sidebarVariants.js";

interface SidebarProps {
  collapsed: boolean;
  maxWidth: number;
  minWidth: number;
  onCollapse: () => void;
  onExpand: () => void;
  resizeHandleProps: ResizeHandleProps;
  resizing: boolean;
  width: number;
}

export function Sidebar(props: SidebarProps) {
  const { pathname } = useLocation();
  const SidebarNav = resolveSidebarNav(pathname);
  const hideBrandText = props.width <= 188;

  return (
    <aside
      className={cn(
        "bg-sidebar-shell relative h-dvh shrink-0 overflow-hidden border-r border-line",
        !props.resizing && "transition-[width] duration-200 ease-expo",
      )}
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
        <SidebarLogo
          collapsed={props.collapsed}
          hideBrandText={hideBrandText}
          onCollapse={props.onCollapse}
          onExpand={props.onExpand}
        />

        <SidebarNav collapsed={props.collapsed} />

        <SidebarFooter collapsed={props.collapsed} />
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
