import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpServerInfo, McpToolInfo } from "@clawbot/shared";
import { ServerDetailModal, ServerEditorModal } from "./McpPage.js";

const server: McpServerInfo = {
  id: "server-1",
  name: "tapd-server",
  slug: "tapd",
  transport: "stdio",
  command: "npx @tapd/mcp-server --token env:TAPD_TOKEN --workspace demo",
  args: ["--token", "env:TAPD_TOKEN"],
  env: { TAPD_TOKEN: "***" },
  cwd: "/srv/tapd",
  enabled: true,
  status: "connected",
  last_error: null,
  last_seen_at: "2026-04-19T10:30:00.000Z",
  created_at: "2026-04-19T08:00:00.000Z",
  updated_at: "2026-04-19T10:30:00.000Z",
  tool_count: 2,
};

const tools: McpToolInfo[] = [
  {
    id: "tool-1",
    server_id: "server-1",
    server_name: "tapd-server",
    server_slug: "tapd",
    remote_name: "query_workitems",
    local_name: "tapd.query_workitems",
    summary: "Query work items from TAPD.",
    input_schema: {},
    enabled: true,
    last_seen_at: "2026-04-19T10:30:00.000Z",
  },
];

function renderServerModal(initialTab: "config" | "tools") {
  return renderToStaticMarkup(
    <ServerDetailModal
      server={server}
      tools={tools}
      serverBusy={false}
      busyToolId={null}
      onClose={() => {}}
      onRefresh={() => {}}
      onEdit={() => {}}
      onToggleServer={() => {}}
      onDelete={() => {}}
      onToggleTool={() => {}}
      initialTab={initialTab}
    />,
  );
}

test("ServerDetailModal follows the skills-style configuration layout", () => {
  const html = renderServerModal("config");

  assert.match(html, /当前状态：/);
  assert.match(html, />Server ID</);
  assert.match(html, />传输</);
  assert.match(html, />工作目录</);
  assert.match(html, />Tool 数</);
  assert.match(html, /配置/);
  assert.match(html, /工具/);
  assert.match(html, /标准 JSON/);
  assert.match(html, /tapd-server/);
  assert.match(html, /刷新目录/);
  assert.doesNotMatch(html, /MCP Server Detail/);
  assert.doesNotMatch(html, /Last Seen/);
  assert.doesNotMatch(html, /Discovered Tools/);
});

test("ServerDetailModal shows MCP tools in one consolidated panel", () => {
  const html = renderServerModal("tools");

  assert.match(html, /已发现工具/);
  assert.match(html, /tapd\.query_workitems/);
  assert.match(html, /query_workitems/);
  assert.match(html, /Query work items from TAPD\./);
});

test("ServerEditorModal uses the revised modal presentation", () => {
  const html = renderToStaticMarkup(
    <ServerEditorModal
      mode="create"
      jsonText='{"name":"tapd"}'
      error={null}
      busy={false}
      onClose={() => {}}
      onChange={() => {}}
      onFillExample={() => {}}
      onSubmit={() => {}}
    />,
  );

  assert.match(html, /粘贴标准 MCP JSON/);
  assert.match(html, />模式</);
  assert.match(html, />格式</);
  assert.match(html, />提交</);
  assert.match(html, /输入示例/);
  assert.doesNotMatch(html, /Create Server/);
  assert.doesNotMatch(html, /Edit Server/);
});
