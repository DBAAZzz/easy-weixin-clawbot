import { useState } from "react";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import {
  Button,
  CardToggle,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@clawbot/ui";
import { formatCount, formatDateTime } from "../../lib/format.js";
import { stringifyMcpServerJsonDocument } from "../../lib/mcp-form.js";
import { CompactMetaStrip } from "./CompactMetaStrip.js";
import { DetailTabButton } from "./DetailTabButton.js";
import { ExpandableSummary } from "./ExpandableSummary.js";
import type { ServerDetailTab } from "./types.js";
import { statusLabel } from "./types.js";

export function ServerDetailModal(props: {
  server: McpServerInfo;
  tools: McpToolInfo[];
  serverBusy: boolean;
  busyToolId: string | null;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onEdit: () => void;
  onToggleServer: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onToggleTool: (tool: McpToolInfo) => void | Promise<void>;
  initialTab?: ServerDetailTab;
}) {
  const [activeTab, setActiveTab] = useState<ServerDetailTab>(props.initialTab ?? "config");
  const overviewItems = [
    { label: "Server ID", value: props.server.slug, mono: true },
    { label: "传输", value: props.server.transport },
    { label: "工作目录", value: props.server.cwd ?? "跟随服务进程", mono: true },
    { label: "Tool 数", value: formatCount(props.server.tool_count) },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-section bg-glass-92">
          <DialogClose
            label="关闭 MCP server 详情"
            className="absolute right-5 top-5 z-20 size-9 border-transparent bg-transparent text-muted hover:border-transparent hover:bg-transparent hover:text-ink"
          />

          <DialogHeader className="py-5">
            <div className="pr-10">
              <DialogTitle className="truncate">{props.server.name}</DialogTitle>
              <p className="mt-2 text-sm text-muted">
                当前状态：
                <span className="font-medium text-ink">
                  {props.server.enabled ? " 已启用" : " 已停用"} ·{" "}
                  {statusLabel(props.server.status)}
                </span>
                {props.server.last_error ? (
                  <span className="text-red-700"> · 最近一次连接异常</span>
                ) : null}
              </p>
              <ExpandableSummary text={props.server.command} />
            </div>

            <CompactMetaStrip items={overviewItems} />
          </DialogHeader>

          <DialogBody className="py-6">
            <div
              role="tablist"
              aria-label="MCP Server 详情视图"
              className="flex flex-wrap items-center gap-6 border-b border-line"
            >
              <DetailTabButton
                tab="config"
                activeTab={activeTab}
                label="配置"
                onSelect={setActiveTab}
              />
              <DetailTabButton
                tab="tools"
                activeTab={activeTab}
                label="工具"
                onSelect={setActiveTab}
              />
            </div>

            <div className="pt-6">
              {activeTab === "config" ? (
                <div
                  id="mcp-server-panel-config"
                  role="tabpanel"
                  aria-labelledby="mcp-server-tab-config"
                >
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={props.serverBusy}
                        onClick={() => void props.onRefresh()}
                      >
                        刷新目录
                      </Button>
                      <Button size="sm" variant="secondary" onClick={props.onEdit}>
                        编辑配置
                      </Button>
                      <Button
                        size="sm"
                        variant={props.server.enabled ? "secondary" : "primary"}
                        disabled={props.serverBusy}
                        onClick={() => void props.onToggleServer()}
                      >
                        {props.server.enabled ? "停用 Server" : "启用 Server"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={props.serverBusy}
                        onClick={() => void props.onDelete()}
                      >
                        删除配置
                      </Button>
                    </div>

                    <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                      <div className="space-y-6">
                        {props.server.last_error ? (
                          <p className="text-sm leading-6 text-red-700">
                            最近一次异常：{props.server.last_error}
                          </p>
                        ) : null}

                        <div>
                          <p className="text-xs tracking-label text-muted">标准 JSON</p>
                          <pre className="mt-3 overflow-x-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                            {stringifyMcpServerJsonDocument(props.server)}
                          </pre>
                        </div>

                        <div className="border-t border-line pt-6">
                          <p className="text-xs tracking-label text-muted">最近活跃</p>
                          <p className="mt-3 text-base leading-7 text-muted-strong">
                            {formatDateTime(props.server.last_seen_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  id="mcp-server-panel-tools"
                  role="tabpanel"
                  aria-labelledby="mcp-server-tab-tools"
                >
                  <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                    <div className="space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs tracking-label text-muted">已发现工具</p>
                        <p className="text-sm text-muted">{formatCount(props.tools.length)} 项</p>
                      </div>

                      <div className="space-y-3">
                        {props.tools.length > 0 ? (
                          props.tools.map((tool) => (
                            <div
                              key={tool.id}
                              className="flex items-start gap-4 rounded-panel border border-line bg-white/78 px-4 py-4"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-mono text-sm text-ink">
                                  {tool.local_name}
                                </p>
                                <p className="mt-1 text-base text-muted-strong">
                                  {tool.remote_name}
                                </p>
                                <p className="mt-2 text-sm leading-6 text-muted">
                                  {tool.summary ?? "该 MCP tool 未提供描述。"}
                                </p>
                              </div>

                              <div className="flex shrink-0 flex-col items-end gap-1.5">
                                <CardToggle
                                  enabled={tool.enabled}
                                  busy={props.busyToolId === tool.id}
                                  label={tool.enabled ? "停用 MCP 工具" : "启用 MCP 工具"}
                                  onToggle={() => props.onToggleTool(tool)}
                                />
                                <span className="text-xs font-medium text-muted">
                                  {tool.enabled ? "已启用" : "已停用"}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-panel border border-dashed border-line bg-white/60 px-4 py-8 text-center text-base text-muted">
                            暂无 MCP tool
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
