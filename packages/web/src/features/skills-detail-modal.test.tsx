import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  MarkdownSource,
  SkillInfo,
  SkillProvisionLog,
  SkillProvisionPlan,
} from "@clawbot/shared";
import { SkillDetailModal } from "./SkillsPage.js";

const runtimeSkill: SkillInfo = {
  name: "local-rag",
  summary: "本地检索增强 skill",
  version: "1.8.0",
  type: "skill",
  activation: "on-demand",
  origin: "user",
  enabled: true,
  runtimeKind: "python-script-set",
  entrypointPath: "skills/local-rag/main.py",
  dependencyNames: ["sentence-transformers", "faiss-cpu"],
  scriptSet: ["index.py", "query.py"],
  hasRuntime: true,
  provisionStatus: "ready",
  installedAt: "2026-04-18T08:30:00.000Z",
  author: "clawbot",
  filePath: "data/skills/user/local-rag.md",
};

const longSummarySkill: SkillInfo = {
  ...runtimeSkill,
  summary:
    "这是一个面向投研和本地数据检索的长描述，用来验证详情弹窗在信息很多时不会直接把整段摘要完全摊开，而是默认只展示前两行，并通过更多按钮继续展开完整内容。",
};

const markdownSource: MarkdownSource = {
  markdown: "# Local RAG\n\nUse this skill to query the local knowledge base.",
};

const provisionPlan: SkillProvisionPlan = {
  runtime: "python",
  installer: "uv-pip",
  createEnv: true,
  commandPreview: ["uv venv .venv", "uv pip install sentence-transformers faiss-cpu"],
  dependencies: [
    {
      name: "sentence-transformers",
      source: "markdown-install",
      confidence: "high",
    },
    {
      name: "faiss-cpu",
      source: "import-scan",
      confidence: "medium",
    },
  ],
};

const provisionLogs: SkillProvisionLog[] = [
  { level: "info", message: "创建虚拟环境", timestamp: 1_712_345_678_901 },
  { level: "warn", message: "检测到缓存未命中", timestamp: 1_712_345_679_111 },
];

function renderModal(activeTab: "markdown" | "runtime", skill: SkillInfo = runtimeSkill) {
  return renderToStaticMarkup(
    <SkillDetailModal
      skill={skill}
      source={{ data: markdownSource, loading: false, error: null }}
      activeTab={activeTab}
      preflightBusy={false}
      provisionBusy={false}
      preflight={provisionPlan}
      preflightError={null}
      logs={provisionLogs}
      onTabChange={() => {}}
      onClose={() => {}}
      onPreflight={() => {}}
      onProvision={() => {}}
      onReprovision={() => {}}
    />,
  );
}

function countMatches(text: string, pattern: string) {
  return text.split(pattern).length - 1;
}

test("SkillDetailModal renders a concise markdown tab without helper chrome", () => {
  const html = renderModal("markdown", longSummarySkill);

  assert.equal(countMatches(html, "版本"), 1);
  assert.equal(countMatches(html, "激活方式"), 1);
  assert.equal(countMatches(html, "来源"), 1);
  assert.equal(countMatches(html, "1.8.0"), 1);
  assert.equal(countMatches(html, "On-Demand"), 1);
  assert.equal(countMatches(html, "用户层"), 1);
  assert.match(html, /当前状态：/);
  assert.match(html, />状态</);
  assert.match(html, /已启用/);
  assert.match(html, /\.\.\.更多/);
  assert.match(html, /Use this skill to query the local knowledge base\./);
  assert.doesNotMatch(html, /Skill Detail/);
  assert.doesNotMatch(html, /Markdown 文档/);
  assert.doesNotMatch(html, /过滤 frontmatter 后展示正文内容/);
  assert.doesNotMatch(html, /路径：/);
  assert.doesNotMatch(html, /停用 Skill/);
  assert.doesNotMatch(html, /aria-hidden="true" class="size-5"/);
});

test("SkillDetailModal renders environment details as one consolidated flow", () => {
  const html = renderModal("runtime");

  assert.match(html, /环境配置/);
  assert.match(html, /dependencies/);
  assert.match(html, /installer/);
  assert.match(html, /commands/);
  assert.match(html, /sentence-transformers/);
  assert.match(html, /创建虚拟环境/);
  assert.match(html, /uv venv \.venv/);
  assert.match(html, /重新检测/);
  assert.match(html, />安装</);
  assert.doesNotMatch(html, />运行时</);
  assert.doesNotMatch(html, /入口/);
  assert.doesNotMatch(html, /安装时间/);
  assert.doesNotMatch(html, /安装状态/);
  assert.doesNotMatch(html, /预检/);
  assert.doesNotMatch(html, /流式安装/);
  assert.doesNotMatch(html, /运行时状态/);
  assert.doesNotMatch(html, /Use this skill to query the local knowledge base\./);
});
