import assert from "node:assert/strict";
import test from "node:test";
import { parseMdContent } from "../shared/parser.js";
import { createSkillSource } from "./compiler.js";

test("createSkillSource normalizes common third-party frontmatter fields", () => {
  const markdown = [
    "---",
    "name: akshare-stock-analysis",
    'description: "专业股票分析技能"',
    'license: "Copyright 2026"',
    "---",
    "# Skill body",
    "",
    "content",
  ].join("\n");

  const parsed = parseMdContent(markdown, "/tmp/SKILL.md");
  const source = createSkillSource(parsed);

  assert.equal(source.name, "akshare-stock-analysis");
  assert.equal(source.type, "skill");
  assert.equal(source.summary, "专业股票分析技能");
  assert.equal(source.version, "0.0.0");
  assert.equal(source.activation, "on-demand");
});

test("createSkillSource keeps missing type as skill even with handler and inputSchema", () => {
  const markdown = [
    "---",
    "name: akshare-exec",
    "version: 1.0.0",
    "description: 可执行技能",
    "handler: python-venv",
    "inputSchema:",
    "  subcommand:",
    "    type: string",
    "    description: 子命令",
    "---",
    "# Skill body",
  ].join("\n");

  const parsed = parseMdContent(markdown, "/tmp/SKILL.md");
  const source = createSkillSource(parsed);

  assert.equal(source.type, "skill");
  assert.equal(source.handler, "python-venv");
  assert.ok(source.inputSchema);
  assert.equal(source.inputSchema?.subcommand?.type, "string");
});

