import { useState } from "react";
import { Outlet } from "react-router-dom";
import { SettingsDialog } from "../components/settings/SettingsDialog.js";
import { Sidebar } from "./Sidebar.js";
import { useAccounts } from "../hooks/useAccounts.js";
import { useHealth } from "../hooks/useHealth.js";

export function AppShell() {
  const { accounts } = useAccounts();
  const health = useHealth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative h-dvh overflow-hidden">
      <div className="grid h-dvh gap-0 overflow-hidden lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[268px_minmax(0,1fr)]">
        <Sidebar
          accounts={accounts}
          health={health.health ?? undefined}
          healthLoading={health.loading}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <main className="bg-main-shell min-w-0 overflow-hidden border-l border-line backdrop-blur-xl">
          <div className="h-full overflow-y-auto p-4 md:p-6 xl:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
