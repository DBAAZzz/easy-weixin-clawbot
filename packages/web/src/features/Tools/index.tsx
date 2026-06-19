import { startTransition } from "react";
import { Card } from "@clawbot/ui";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import { StatsGrid } from "../Dashboard/StatsGrid.js";
import { useToolsPage } from "./useToolsPage.js";
import "./tools.css";
import { ToolDetailModal } from "./ToolDetailModal.js";
import { ToolsTable } from "./ToolsTable.js";

export { ToolDetailModal };

export function ToolsPage() {
  const {
    tools,
    loading,
    error,
    query,
    setQuery,
    setActiveToolName,
    onlyEnabled,
    setOnlyEnabled,
    filteredTools,
    activeTool,
    stats,
    handleRefresh,
  } = useToolsPage();

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
        <DashboardHeader
          eyebrow="Tools"
          title="工具"
          description="管理已安装工具能力，查看来源、参数与启用状态"
          refreshLabel="刷新列表"
          onRefresh={() => void handleRefresh()}
        />
        <StatsGrid stats={stats} />

        {error ? (
          <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
            加载 tool 列表失败：{error}
          </div>
        ) : null}

        <Card className="overflow-hidden !p-0">
          <ToolsTable
            errorEmpty={tools.length === 0}
            filteredTools={filteredTools}
            loading={loading}
            onlyEnabled={onlyEnabled}
            query={query}
            setQuery={setQuery}
            tools={tools}
            onOnlyEnabledChange={setOnlyEnabled}
            onOpenTool={(tool) => startTransition(() => setActiveToolName(tool.name))}
          />
        </Card>
      </div>

      {activeTool ? (
        <ToolDetailModal tool={activeTool} onClose={() => setActiveToolName(null)} />
      ) : null}
    </>
  );
}
