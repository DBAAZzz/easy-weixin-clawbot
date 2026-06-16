import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolInfo } from "@clawbot/shared";
import { ToolDetailModal } from "./ToolsPage.js";

const tool: ToolInfo = {
  name: "opencli",
  description:
    "这是一个用于命令行桥接的长描述，用来验证 tool 详情弹窗会像 skill 一样在头部做摘要折叠，而不是继续使用原来分散的 badge 和块状信息。",
  type: "tool",
  handler: "cli",
  origin: "builtin",
  enabled: true,
  managedBySystem: true,
  parameterNames: ["command", "timeout"],
};

function renderToolModal() {
  return renderToStaticMarkup(<ToolDetailModal tool={tool} onClose={() => {}} />);
}

test("ToolDetailModal renders code-defined tool details", () => {
  const html = renderToolModal();

  assert.match(html, /当前状态：/);
  assert.match(html, /\.\.\.更多/);
  assert.match(html, />Handler</);
  assert.match(html, />来源</);
  assert.match(html, />状态</);
  assert.match(html, /代码内置/);
  assert.match(html, /参数快照/);
  assert.match(html, /输入参数/);
  assert.match(html, /&quot;handler&quot;: &quot;cli&quot;/);
  assert.match(html, /&quot;command&quot;/);
  assert.match(html, /&quot;timeout&quot;/);
  assert.doesNotMatch(html, /Markdown Source/);
  assert.doesNotMatch(html, /停用 Tool/);
});
