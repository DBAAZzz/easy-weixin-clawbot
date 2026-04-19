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

test("detectSkillRuntime classifies multi-script packages as python-script-set", async () => {
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

      assert.equal(detected.kind, "python-script-set");
      assert.ok(!detected.entrypoint, "script-set should have no entrypoint");
      assert.deepEqual(detected.scriptSet?.sort(), ["scripts/first.py", "scripts/second.py"]);
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

test("detectSkillRuntime handles root-level scripts (stock-manager compat pattern)", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: stock-manager",
        'description: "股票管理"',
        "---",
        "# Stock Manager",
      ].join("\n"),
      "main.py": "import akshare\nprint('main')\n",
      "utils.py": "import json\ndef helper(): pass\n",
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
      assert.equal(detected.entrypoint?.path, "main.py");
      assert.ok(detected.dependencies.some((d) => d.name === "akshare"));
    },
  );
});

test("detectSkillRuntime ignores local modules and stdlib for root-level compat skills", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: stock-manager",
        'description: "股票管理"',
        "---",
        "# Stock Manager",
      ].join("\n"),
      "openclaw_entry.py": [
        "import json",
        "from stock_order import StockOrderManager",
        "from stock_info import StockInfoFetcher",
        "",
        "if __name__ == '__main__':",
        "    print('ok')",
      ].join("\n"),
      "stock_order.py": [
        "import os",
        "import shutil",
        "from config import DATA_DIR",
        "",
        "class StockOrderManager:",
        "    pass",
      ].join("\n"),
      "stock_info.py": [
        "import requests",
        "import akshare as ak",
        "import pandas as pd",
        "import yfinance as yf",
        "import shutil",
        "from config import DATA_DIR",
        "",
        "class StockInfoFetcher:",
        "    pass",
      ].join("\n"),
      "config.py": "DATA_DIR = './data'\n",
      "requirements.txt": [
        "requests>=2.31.0",
        "akshare>=1.12.0",
        "pandas>=2.0.0",
        "yfinance>=0.2.28",
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
      assert.equal(detected.entrypoint?.path, "openclaw_entry.py");
      assert.deepEqual(
        detected.dependencies.map((dependency) => dependency.name),
        ["akshare", "pandas", "requests", "yfinance"],
      );
      assert.ok(!detected.dependencies.some((dependency) => dependency.name === "shutil"));
      assert.ok(!detected.dependencies.some((dependency) => dependency.name === "config"));
      assert.ok(!detected.dependencies.some((dependency) => dependency.name === "stock_info"));
      assert.ok(!detected.dependencies.some((dependency) => dependency.name === "stock_order"));
    },
  );
});

test("detectSkillRuntime detects dependencies from requirements.txt", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: req-txt-skill",
        'description: "requirements.txt based"',
        "---",
        "# Skill with requirements.txt",
      ].join("\n"),
      "scripts/main.py": "import pandas\nprint('hello')\n",
      "requirements.txt": "pandas>=2.0\nnumpy==1.25.0\nrequests\n",
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
      assert.equal(detected.entrypoint?.path, "scripts/main.py");
      const depNames = detected.dependencies.map((d) => d.name).sort();
      assert.ok(depNames.includes("pandas"));
      assert.ok(depNames.includes("numpy"));
      assert.ok(depNames.includes("requests"));
    },
  );
});

test("detectSkillRuntime returns manual-needed for mixed runtimes", async () => {
  await withTempSkill(
    {
      "SKILL.md": [
        "---",
        "name: mixed-runtime",
        'description: "mixed"',
        "---",
        "# Mixed",
      ].join("\n"),
      "scripts/a.py": "print('python')\n",
      "scripts/b.js": "console.log('node')\n",
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
      assert.ok(detected.issues[0]?.includes("multiple"));
    },
  );
});
