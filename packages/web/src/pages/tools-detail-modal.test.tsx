import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MarkdownSource, ToolInfo } from "@clawbot/shared";
import { ToolDetailModal } from "./ToolsPage.js";

const tool: ToolInfo = {
  name: "opencli",
  summary:
    "这是一个用于命令行桥接的长描述，用来验证 tool 详情弹窗会像 skill 一样在头部做摘要折叠，而不是继续使用原来分散的 badge 和块状信息。",
  version: "1.2.3",
  author: "clawbot",
  type: "tool",
  handler: "cli",
  origin: "user",
  enabled: true,
  parameterNames: ["command", "timeout"],
};

const source: MarkdownSource = {
  markdown: `---
name: opencli
---
# OpenCLI

Use this tool to run a CLI command safely.`,
};

function renderToolModal(initialTab: "markdown" | "config") {
  return renderToStaticMarkup(
    <ToolDetailModal
      tool={tool}
      source={{ data: source, loading: false, error: null }}
      toggleBusy={false}
      onClose={() => {}}
      onToggle={() => {}}
      initialTab={initialTab}
    />,
  );
}

test("ToolDetailModal uses the skills-style markdown presentation", () => {
  const html = renderToolModal("markdown");

  assert.match(html, /当前状态：/);
  assert.match(html, /\.\.\.更多/);
  assert.match(html, />版本</);
  assert.match(html, />Handler</);
  assert.match(html, />来源</);
  assert.match(html, />状态</);
  assert.match(html, /文档/);
  assert.match(html, /参数配置/);
  assert.match(html, /Use this tool to run a CLI command safely\./);
  assert.doesNotMatch(html, /Tool Detail/);
  assert.doesNotMatch(html, /Markdown Source/);
  assert.doesNotMatch(html, /Parameters/);
});

test("ToolDetailModal consolidates parameter data into one panel", () => {
  const html = renderToolModal("config");

  assert.match(html, /参数快照/);
  assert.match(html, /输入参数/);
  assert.match(html, /&quot;handler&quot;: &quot;cli&quot;/);
  assert.match(html, /&quot;command&quot;/);
  assert.match(html, /&quot;timeout&quot;/);
  assert.match(html, /停用 Tool/);
  assert.doesNotMatch(html, /Markdown Source/);
});
