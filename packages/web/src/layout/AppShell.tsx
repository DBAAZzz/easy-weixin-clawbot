import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";
import { useAccounts } from "../hooks/useAccounts.js";
import { useHealth } from "../hooks/useHealth.js";

export function AppShell() {
  const { accounts } = useAccounts();
  const health = useHealth();

  return (
    <div className="relative h-[100dvh] overflow-hidden">
      <div className="grid h-[100dvh] gap-0 overflow-hidden lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[292px_minmax(0,1fr)]">
        <Sidebar
          accounts={accounts}
          health={health.health ?? undefined}
          healthLoading={health.loading}
        />
        <main className="min-w-0 overflow-hidden border-l border-[var(--line)] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(247,250,251,0.96))] backdrop-blur-xl">
          <div className="h-full overflow-y-auto p-4 md:p-6 xl:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
