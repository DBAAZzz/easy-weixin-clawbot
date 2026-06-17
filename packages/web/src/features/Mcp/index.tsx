import { startTransition } from "react";
import { ActivityIcon, Button, Input, LinkIcon, SearchIcon, XIcon } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { TAPD_MCP_JSON_EXAMPLE } from "../../lib/mcp-form.js";
import { McpToolCard } from "./McpToolCard.js";
import { ServerCard } from "./ServerCard.js";
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
    toolQuery,
    setToolQuery,
    setActiveServerId,
    editorState,
    setEditorState,
    editorText,
    setEditorText,
    editorError,
    setEditorError,
    notice,
    setNotice,
    mutationError,
    serverBusyId,
    toolBusyId,
    editorBusy,
    filterServerId,
    setFilterServerId,
    filteredServers,
    filteredTools,
    activeServer,
    activeServerTools,
    connectedCount,
    enabledToolCount,
    filterServer,
    handleRefreshList,
    handleServerAction,
    handleToolToggle,
    handleEditorSubmit,
    handleDeleteServer,
  } = useMcpPage();

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">MCP Servers</p>
              <h2 className="mt-1.5 text-6xl text-ink">
                远端 tools 接入中心
                <span className="ml-2 align-middle text-lg font-normal text-muted">
                  ({connectedCount}/{servers.length} 已连接)
                </span>
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void handleRefreshList()}>
                <ActivityIcon className="size-4" />
                刷新列表
              </Button>
              <Button
                size="sm"
                onClick={() => startTransition(() => setEditorState({ mode: "create" }))}
              >
                新建配置
              </Button>
            </div>
          </div>

          <div className="relative w-full xl:max-w-[360px]">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              value={serverQuery}
              onChange={(event) => setServerQuery(event.target.value)}
              placeholder="搜索 server 名称、slug、命令或状态"
              className="h-10 rounded-lg pl-10"
            />
          </div>
        </section>

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载 MCP 列表失败：{error}
          </div>
        ) : null}

        {mutationError ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            操作失败：{mutationError}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-section border border-notice-success-border bg-notice-success-bg px-4 py-3 text-base leading-6 text-accent-strong">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-lg border border-line bg-glass-80 px-3.5 py-3.5 md:px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="ui-skeleton size-10 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ui-skeleton h-5 rounded-lg" />
                    <div className="ui-skeleton h-4 rounded-lg" />
                    <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                  </div>
                  <div className="ui-skeleton h-8 w-[50px] rounded-full" />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {!loading && filteredServers.length === 0 ? (
          <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
            <p className="text-xl font-medium text-ink">
              {servers.length === 0 ? "还没有 MCP 配置" : "没有匹配到 MCP server"}
            </p>
          </section>
        ) : null}

        {!loading && filteredServers.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <LinkIcon className="size-4 text-muted-strong" />
              <span>当前展示 {formatCount(filteredServers.length)} 个 MCP server</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {filteredServers.map((server, index) => (
                <ServerCard
                  key={server.id}
                  server={server}
                  index={index}
                  busy={serverBusyId === server.id}
                  selected={filterServerId === server.id}
                  onOpen={() =>
                    startTransition(() => {
                      setFilterServerId(server.id);
                      setActiveServerId(server.id);
                    })
                  }
                  onToggle={() =>
                    handleServerAction(server, async () => {
                      const result = server.enabled
                        ? await disableServer(server.id)
                        : await enableServer(server.id);
                      setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
                    })
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="bg-frost-72 mt-2 space-y-3 rounded-dialog py-5">
          {" "}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="text-xs uppercase tracking-label-xl text-muted">Discovered Tools</p>
                <h3 className="mt-1.5 text-5xl text-ink">
                  MCP tools 目录
                  <span className="ml-2 align-middle text-md font-normal text-muted">
                    ({enabledToolCount}/{tools.length} 已启用)
                  </span>
                </h3>
              </div>
              {filterServer ? (
                <button
                  type="button"
                  onClick={() => setFilterServerId(null)}
                  className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-notice-success-border bg-notice-success-bg px-3 py-1 text-sm font-medium text-accent-strong transition hover:bg-success-solid"
                >
                  筛选：{filterServer.name}
                  <XIcon className="size-3" />
                </button>
              ) : null}
            </div>

            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={toolQuery}
                onChange={(event) => setToolQuery(event.target.value)}
                placeholder="搜索 tool 名称 / server"
                className="h-10 rounded-lg pl-10"
              />
            </div>
          </div>
          {!loading && filteredTools.length === 0 ? (
            <section className="rounded-lg border border-dashed border-line bg-glass-48 px-5 py-8 text-center">
              <p className="text-lg font-medium text-ink">
                {filterServer ? `${filterServer.name} 下暂无匹配的 tool` : "没有匹配到 MCP tool"}
              </p>
            </section>
          ) : null}
          {filteredTools.length > 0 ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredTools.map((tool) => (
                <McpToolCard
                  key={tool.id}
                  tool={tool}
                  busy={toolBusyId === tool.id}
                  onToggle={() => handleToolToggle(tool)}
                />
              ))}
            </div>
          ) : null}
        </section>
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
              setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
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
    </>
  );
}
