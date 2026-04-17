import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { scanSkillPackage } from "./package-scanner.js";
import { detectSkillRuntime } from "./runtime-detector.js";
import { compileSkill, createSkillSource } from "./compiler.js";
import { parseMdContent } from "../shared/parser.js";

async function withTempSkill(
  files: Record<string, string>,
  run: (rootDir: string) => Promise<void>,
) {
  const rootDir = await mkdtemp(join(tmpdir(), "skill-runtime-detector-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = join(rootDir, relativePath);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("detectSkillRuntime recognizes a python script skill from scripts directory and install block", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: akshare-a-stock",
        'description: "A股数据分析"',
        "---",
        "# A股数据分析",
        "",
        "```bash",
        "uv pip install akshare",
        "```",
      ].join("\n"),
      "scripts/stock_cli.py": [
        "import akshare as ak",
        "",
        "if __name__ == '__main__':",
        "    print('ok')",
      ].join("\n"),
      "references/api-reference.md": "# API Reference",
    },
    async (rootDir) => {
      const parsed = parseMdContent(
        await readFile(join(rootDir, "SKILL.md"), "utf8"),
        join(rootDir, "SKILL.md"),
      );
      const compiled = compileSkill(createSkillSource(parsed));
      const packageIndex = await scanSkillPackage(rootDir);
      const detected = await detectSkillRuntime(compiled, packageIndex);

      assert.equal(detected.kind, "python-script");
      assert.equal(detected.entrypoint?.path, "scripts/stock_cli.py");
      assert.equal(detected.preferredInstaller, "uv-pip");
      assert.deepEqual(
        detected.dependencies.map((dependency) => [dependency.name, dependency.confidence]),
        [["akshare", "high"]],
      );
    },
  );
});

test("detectSkillRuntime marks ambiguous multi-script packages as manual-needed", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: multi-script-skill",
        'description: "多脚本技能"',
        "---",
        "# Multi Script",
      ].join("\n"),
      "scripts/first.py": "print('a')\n",
      "scripts/second.py": "print('b')\n",
    },
    async (rootDir) => {
      const parsed = parseMdContent(
        await readFile(join(rootDir, "SKILL.md"), "utf8"),
        join(rootDir, "SKILL.md"),
      );
      const compiled = compileSkill(createSkillSource(parsed));
      const packageIndex = await scanSkillPackage(rootDir);
      const detected = await detectSkillRuntime(compiled, packageIndex);

      assert.equal(detected.kind, "manual-needed");
      assert.ok(detected.issues[0]?.includes("entrypoint"));
    },
  );
});

test("detectSkillRuntime recognizes a node script skill from scripts directory and install block", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: stock-node-skill",
        'description: "Node 技能"',
        "---",
        "# Node Skill",
        "",
        "```bash",
        "npm install axios",
        "```",
      ].join("\n"),
      "scripts/stock_cli.js": [
        "const axios = require('axios');",
        "console.log(process.argv.slice(2).join(' '));",
      ].join("\n"),
    },
    async (rootDir) => {
      const parsed = parseMdContent(
        await readFile(join(rootDir, "SKILL.md"), "utf8"),
        join(rootDir, "SKILL.md"),
      );
      const compiled = compileSkill(createSkillSource(parsed));
      const packageIndex = await scanSkillPackage(rootDir);
      const detected = await detectSkillRuntime(compiled, packageIndex);

      assert.equal(detected.kind, "node-script");
      assert.equal(detected.entrypoint?.path, "scripts/stock_cli.js");
      assert.equal(detected.preferredInstaller, "npm");
      assert.deepEqual(
        detected.dependencies.map((dependency) => [dependency.name, dependency.confidence]),
        [["axios", "high"]],
      );
    },
  );
});

test("detectSkillRuntime ignores python stdlib imports while keeping third-party dependencies", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: stdlib-filter-skill",
        'description: "stdlib filter"',
        "---",
        "# Stdlib Filter",
        "",
        "```bash",
        "pip install akshare pandas numpy",
        "```",
      ].join("\n"),
      "scripts/akshare_cli.py": [
        "import argparse",
        "import json",
        "import sys",
        "import warnings",
        "import requests",
        "import akshare as ak",
        "",
        "warnings.filterwarnings('ignore')",
        "print('ok')",
      ].join("\n"),
    },
    async (rootDir) => {
      const parsed = parseMdContent(
        await readFile(join(rootDir, "SKILL.md"), "utf8"),
        join(rootDir, "SKILL.md"),
      );
      const compiled = compileSkill(createSkillSource(parsed));
      const packageIndex = await scanSkillPackage(rootDir);
      const detected = await detectSkillRuntime(compiled, packageIndex);

      assert.equal(detected.kind, "python-script");
      assert.deepEqual(
        detected.dependencies.map((dependency) => dependency.name),
        ["akshare", "numpy", "pandas", "requests"],
      );
    },
  );
});
