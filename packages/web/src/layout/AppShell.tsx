import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar/index.js";
import { useResizableWidth } from "../hooks/useResizableWidth.js";

const SIDEBAR_MIN_WIDTH = 72;
const SIDEBAR_MAX_WIDTH = 268;
const SIDEBAR_COLLAPSED_THRESHOLD = 112;
const SIDEBAR_WIDTH_STORAGE_KEY = "clawbot_sidebar_width";

export function AppShell() {
  const sidebarWidth = useResizableWidth({
    collapsedThreshold: SIDEBAR_COLLAPSED_THRESHOLD,
    defaultWidth: SIDEBAR_MAX_WIDTH,
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: SIDEBAR_WIDTH_STORAGE_KEY,
  });

  return (
    <div className="relative h-dvh overflow-hidden">
      <div className="flex h-dvh gap-0 overflow-hidden">
        <Sidebar
          collapsed={sidebarWidth.isCollapsed}
          maxWidth={SIDEBAR_MAX_WIDTH}
          minWidth={SIDEBAR_MIN_WIDTH}
          onCollapse={() => sidebarWidth.setWidth(SIDEBAR_MIN_WIDTH)}
          onExpand={() => sidebarWidth.setWidth(SIDEBAR_MAX_WIDTH)}
          resizeHandleProps={sidebarWidth.resizeHandleProps}
          resizing={sidebarWidth.isResizing}
          width={sidebarWidth.width}
        />
        <main className="bg-paper min-w-0 flex-1 overflow-hidden border-l border-line backdrop-blur-xl">
          <div className="h-full overflow-y-auto p-4 md:p-6 xl:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
