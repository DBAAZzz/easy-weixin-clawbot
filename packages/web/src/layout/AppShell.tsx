import { useState } from "react";
import { Outlet } from "react-router-dom";
import { SettingsDialog } from "../components/settings/SettingsDialog.js";
import { Sidebar } from "./Sidebar.js";
import { useAccounts } from "../hooks/useAccounts.js";
import { useHealth } from "../hooks/useHealth.js";
import { useResizableWidth } from "../hooks/useResizableWidth.js";

const SIDEBAR_MIN_WIDTH = 72;
const SIDEBAR_MAX_WIDTH = 268;
const SIDEBAR_COLLAPSED_THRESHOLD = 112;
const SIDEBAR_WIDTH_STORAGE_KEY = "clawbot_sidebar_width";

export function AppShell() {
  const { accounts } = useAccounts();
  const health = useHealth();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
          accounts={accounts}
          collapsed={sidebarWidth.isCollapsed}
          health={health.health ?? undefined}
          healthLoading={health.loading}
          maxWidth={SIDEBAR_MAX_WIDTH}
          minWidth={SIDEBAR_MIN_WIDTH}
          onOpenSettings={() => setSettingsOpen(true)}
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

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
