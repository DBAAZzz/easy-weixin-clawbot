import { startTransition } from "react";
import { Card, ConfirmDialog, toast } from "@clawbot/ui";
import { TAPD_MCP_JSON_EXAMPLE } from "../../lib/mcp-form.js";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import { StatsGrid } from "../Dashboard/StatsGrid.js";
import "./mcp.css";
import { McpServerTable } from "./McpServerTable.js";
import { ServerDetailModal } from "./ServerDetailModal.js";
import { ServerEditorModal } from "./ServerEditorModal.js";
import { useMcpPage } from "./useMcpPage.js";

export { ServerDetailModal } from "./ServerDetailModal.js";
export { ServerEditorModal } from "./ServerEditorModal.js";

export function McpPage() {
  const {
    servers,
    tools,
    loading,
    error,
    refreshServer,
    enableServer,
    disableServer,
    serverQuery,
    setServerQuery,
    setActiveServerId,
    editorState,
    setEditorState,
    editorText,
    setEditorText,
    editorError,
    setEditorError,
    serverBusyId,
    toolBusyId,
    editorBusy,
    filteredServers,
    activeServer,
    activeServerTools,
    stats,
    onlyEnabled,
    setOnlyEnabled,
    expandedServerIds,
    deleteConfirmServer,
    allVisibleExpanded,
    toggleServerExpanded,
    setAllVisibleExpanded,
    cancelDeleteServer,
    confirmDeleteServer,
    handleRefreshList,
    handleServerAction,
    handleToolToggle,
    handleEditorSubmit,
    handleDeleteServer,
  } = useMcpPage();

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
        <DashboardHeader
          eyebrow="MCP Servers"
          title="MCP 服务"
          description="管理服务器，展开任意服务器查看并开关其工具"
          primaryLabel="新增"
          refreshLabel="刷新列表"
          onCreate={() => startTransition(() => setEditorState({ mode: "create" }))}
          onRefresh={() => void handleRefreshList()}
        />
        <StatsGrid stats={stats} />

        {error ? (
          <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
            加载 MCP 列表失败：{error}
          </div>
        ) : null}

        <Card className="overflow-hidden !p-0">
          <McpServerTable
            errorEmpty={servers.length === 0}
            expandedServerIds={expandedServerIds}
            filteredServers={filteredServers}
            loading={loading}
            onlyEnabled={onlyEnabled}
            query={serverQuery}
            serverBusyId={serverBusyId}
            servers={servers}
            setQuery={setServerQuery}
            toolBusyId={toolBusyId}
            tools={tools}
            visibleExpanded={allVisibleExpanded}
            onCreate={() => startTransition(() => setEditorState({ mode: "create" }))}
            onDeleteServer={(server) => void handleDeleteServer(server)}
            onEditServer={(server) =>
              startTransition(() => setEditorState({ mode: "edit", serverId: server.id }))
            }
            onOnlyEnabledChange={setOnlyEnabled}
            onToggleServer={(server) =>
              handleServerAction(server, async () => {
                const result = server.enabled
                  ? await disableServer(server.id)
                  : await enableServer(server.id);
                toast.success(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
              })
            }
            onToggleServerExpanded={toggleServerExpanded}
            onToggleTool={(tool) => handleToolToggle(tool)}
            onToggleVisibleExpanded={() => setAllVisibleExpanded(!allVisibleExpanded)}
          />
        </Card>
      </div>

      {activeServer && !editorState ? (
        <ServerDetailModal
          server={activeServer}
          tools={activeServerTools}
          serverBusy={serverBusyId === activeServer.id}
          busyToolId={toolBusyId}
          onClose={() => setActiveServerId(null)}
          onRefresh={() => handleServerAction(activeServer, () => refreshServer(activeServer.id))}
          onEdit={() =>
            startTransition(() => setEditorState({ mode: "edit", serverId: activeServer.id }))
          }
          onToggleServer={() =>
            handleServerAction(activeServer, async () => {
              const result = activeServer.enabled
                ? await disableServer(activeServer.id)
                : await enableServer(activeServer.id);
              toast.success(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
            })
          }
          onDelete={() => handleDeleteServer(activeServer)}
          onToggleTool={(tool) => handleToolToggle(tool)}
        />
      ) : null}

      {editorState ? (
        <ServerEditorModal
          mode={editorState.mode}
          jsonText={editorText}
          error={editorError}
          busy={editorBusy}
          onClose={() => setEditorState(null)}
          onChange={(value) => {
            setEditorText(value);
            setEditorError(null);
          }}
          onFillExample={() => {
            setEditorText(TAPD_MCP_JSON_EXAMPLE);
            setEditorError(null);
          }}
          onSubmit={() => handleEditorSubmit()}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteConfirmServer)}
        title="删除 MCP 服务"
        tone="danger"
        confirmText="删除"
        cancelText="取消"
        closeOnConfirm={false}
        confirmDisabled={Boolean(deleteConfirmServer) && serverBusyId === deleteConfirmServer?.id}
        onConfirm={() => void confirmDeleteServer()}
        onOpenChange={(open) => {
          if (!open) {
            cancelDeleteServer();
          }
        }}
      >
        {deleteConfirmServer ? (
          <p>确认删除 {deleteConfirmServer.name}？关联工具会一并移除。</p>
        ) : null}
      </ConfirmDialog>
    </>
  );
}
