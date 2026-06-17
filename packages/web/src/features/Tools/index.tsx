import { startTransition } from "react";
import { Badge, Button, Input, ActivityIcon, SearchIcon, TerminalIcon } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { useToolsPage } from "./useToolsPage.js";
import { ToolCard } from "./ToolCard.js";
import { ToolDetailModal } from "./ToolDetailModal.js";

export { ToolDetailModal };

export function ToolsPage() {
  const {
    tools,
    loading,
    error,
    query,
    setQuery,
    setActiveToolName,
    filteredTools,
    activeTool,
    enabledCount,
    handlerCount,
    handleRefresh,
  } = useToolsPage();

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">Tools</p>
              <h2 className="mt-1.5 text-6xl text-ink">已安装工具</h2>
            </div>

            <Button size="sm" onClick={() => void handleRefresh()}>
              <ActivityIcon className="size-4" />
              刷新列表
            </Button>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 tool 名称、描述、handler 或参数"
                className="h-10 rounded-lg pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone="muted">已安装 {formatCount(tools.length)}</Badge>
              <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
              <Badge tone="muted">代码内置</Badge>
              <Badge tone="muted">Handler {formatCount(handlerCount)}</Badge>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载 tool 列表失败：{error}
          </div>
        ) : null}

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
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

        {!loading && filteredTools.length === 0 ? (
          <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
            <p className="text-xl font-medium text-ink">没有匹配到 tool</p>
          </section>
        ) : null}

        {!loading && filteredTools.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <TerminalIcon className="size-4 text-muted-strong" />
              <span>当前展示 {formatCount(filteredTools.length)} 个已安装 tool</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {filteredTools.map((tool, index) => (
                <ToolCard
                  key={tool.name}
                  tool={tool}
                  index={index}
                  onOpen={() => startTransition(() => setActiveToolName(tool.name))}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {activeTool ? (
        <ToolDetailModal tool={activeTool} onClose={() => setActiveToolName(null)} />
      ) : null}
    </>
  );
}
