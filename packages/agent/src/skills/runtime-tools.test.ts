import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { z } from "zod";
import { createSkillRuntimeToolSnapshot } from "./runtime-tools.js";
import type { InstalledSkill, SkillInstaller } from "./types.js";
import type { RuntimeProvisioner, ProvisionLog, ProvisionPlan } from "./runtime-provisioner.js";

const execFileAsync = promisify(execFile);

async function createPythonSkillFixture(scriptContent: string): Promise<{ rootDir: string; installed: InstalledSkill }> {
  const rootDir = await mkdtemp(join(tmpdir(), "runtime-tools-skill-"));
  const scriptPath = join(rootDir, "scripts", "demo.py");
  const venvPythonPath = join(rootDir, ".venv", "bin", "python");
  await mkdir(dirname(scriptPath), { recursive: true });
  await mkdir(dirname(venvPythonPath), { recursive: true });
  await writeFile(join(rootDir, "SKILL.md"), "---\nname: demo-skill\ndescription: demo\n---\n# Demo\n", "utf8");
  await writeFile(scriptPath, scriptContent, "utf8");
  const { stdout } = await execFileAsync("python3", ["-c", "import sys; print(sys.executable)"]);
  await symlink(stdout.trim(), venvPythonPath);

  return {
    rootDir,
    installed: {
      skill: {
        source: {
          name: "demo-skill",
          version: "0.0.0",
          type: "skill",
          summary: "demo",
          activation: "on-demand",
          body: "# Demo",
          filePath: join(rootDir, "SKILL.md"),
        },
        packageIndex: {
          rootDir,
          skillMdPath: join(rootDir, "SKILL.md"),
          referenceFiles: [],
          scriptFiles: ["scripts/demo.py"],
          rootScriptFiles: [],
        },
        detectedRuntime: {
          kind: "python-script",
          preferredInstaller: "pip",
          entrypoint: {
            path: "scripts/demo.py",
            runtime: "python",
            source: "single-script",
          },
          dependencies: [],
          issues: [],
          evidence: ["scripts/demo.py"],
        },
      },
      origin: "user",
      enabled: true,
      installedAt: new Date().toISOString(),
      provisionStatus: "ready",
    },
  };
}

async function createRelativePythonSkillFixture(scriptContent: string): Promise<{ rootDir: string; installed: InstalledSkill }> {
  const rootDir = await mkdtemp(join(process.cwd(), ".tmp-runtime-tools-skill-"));
  const scriptPath = join(rootDir, "scripts", "demo.py");
  const venvPythonPath = join(rootDir, ".venv", "bin", "python");
  await mkdir(dirname(scriptPath), { recursive: true });
  await mkdir(dirname(venvPythonPath), { recursive: true });
  await writeFile(join(rootDir, "SKILL.md"), "---\nname: demo-skill-relative\ndescription: demo\n---\n# Demo\n", "utf8");
  await writeFile(scriptPath, scriptContent, "utf8");
  const { stdout } = await execFileAsync("python3", ["-c", "import sys; print(sys.executable)"]);
  await symlink(stdout.trim(), venvPythonPath);

  const relativeRootDir = relative(process.cwd(), rootDir);

  return {
    rootDir,
    installed: {
      skill: {
        source: {
          name: "demo-skill-relative",
          version: "0.0.0",
          type: "skill",
          summary: "demo",
          activation: "on-demand",
          body: "# Demo",
          filePath: join(relativeRootDir, "SKILL.md"),
        },
        packageIndex: {
          rootDir: relativeRootDir,
          skillMdPath: join(relativeRootDir, "SKILL.md"),
          referenceFiles: [],
          scriptFiles: ["scripts/demo.py"],
          rootScriptFiles: [],
        },
        detectedRuntime: {
          kind: "python-script",
          preferredInstaller: "pip",
          entrypoint: {
            path: "scripts/demo.py",
            runtime: "python",
            source: "single-script",
          },
          dependencies: [],
          issues: [],
          evidence: ["scripts/demo.py"],
        },
      },
      origin: "user",
      enabled: true,
      installedAt: new Date().toISOString(),
      provisionStatus: "ready",
    },
  };
}

function createStubInstaller(installed: InstalledSkill): SkillInstaller {
  return {
    initialize: async () => ({ loaded: [], failed: [] }),
    list: () => [],
    get: () => null,
    getSource: async () => null,
    validate: async () => {
      throw new Error("not implemented");
    },
    install: async () => {
      throw new Error("not implemented");
    },
    installDirectory: async () => {
      throw new Error("not implemented");
    },
    update: async () => {
      throw new Error("not implemented");
    },
    remove: async () => {},
    enable: async () => {
      throw new Error("not implemented");
    },
    disable: async () => {
      throw new Error("not implemented");
    },
    getInstalled: (name) => (name === installed.skill.source.name ? installed : null),
    setProvisionStatus: async (_name, status, error) => {
      installed.provisionStatus = status;
      installed.provisionError = error;
    },
  };
}

function createStubProvisioner(): RuntimeProvisioner {
  return {
    preflight: async (): Promise<ProvisionPlan> => ({
      runtime: "python",
      installer: "pip",
      createEnv: false,
      commandPreview: [],
      dependencies: [],
    }),
    provision: async (): Promise<ProvisionLog[]> => [],
    async *provisionStream(): AsyncGenerator<ProvisionLog> {
      yield { level: "info", message: "ok", timestamp: Date.now() };
    },
    reprovision: async (): Promise<ProvisionLog[]> => [],
    healthCheck: async () => true,
  };
}

test("run_skill_script transparently serializes python date objects without modifying the skill", async () => {
  const fixture = await createPythonSkillFixture([
    "import json",
    "from datetime import date",
    "",
    "print(json.dumps([{'日期': date(2025, 4, 17), '值': 1}], ensure_ascii=False))",
  ].join("\n"));

  try {
    const installer = createStubInstaller(fixture.installed);
    const provisioner = createStubProvisioner();
    const snapshot = createSkillRuntimeToolSnapshot(installer, provisioner);
    const tool = snapshot.tools.find((item) => item.name === "run_skill_script");

    assert.ok(tool);
    assert.ok(z.object({}).safeParse({}).success);

    const result = await tool.execute(
      { skill_name: "demo-skill" },
      { signal: AbortSignal.timeout(10_000) },
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.type, "text");
    assert.match((result[0] as { text: string }).text, /2025-04-17/);
    assert.doesNotMatch((result[0] as { text: string }).text, /not JSON serializable/);
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});

test("run_skill_script resolves relative skill roots without nesting executable paths", async () => {
  const fixture = await createRelativePythonSkillFixture("print('relative-root-ok')\n");

  try {
    const installer = createStubInstaller(fixture.installed);
    const provisioner = createStubProvisioner();
    const snapshot = createSkillRuntimeToolSnapshot(installer, provisioner);
    const tool = snapshot.tools.find((item) => item.name === "run_skill_script");

    assert.ok(tool);

    const result = await tool.execute(
      { skill_name: "demo-skill-relative" },
      { signal: AbortSignal.timeout(10_000) },
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.type, "text");
    assert.match((result[0] as { text: string }).text, /relative-root-ok/);
  } finally {
    await rm(fixture.rootDir, { recursive: true, force: true });
  }
});
