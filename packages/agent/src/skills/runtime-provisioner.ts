import { execFile } from "node:child_process";
import { readFile, writeFile, stat, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { InstalledSkill, ProvisionStatus, SkillRuntimeDecl } from "./types.js";

export interface ProvisionPlan {
  runtime: "python" | "node";
  steps: string[];
  dependencies: string[];
}

export interface ProvisionLog {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}

export interface ManagedMeta {
  schemaVersion: number;
  runtime: string;
  dependencies: string[];
  entrypoint?: string;
  status: ProvisionStatus;
  error?: string;
  updatedAt: string;
}

export interface RuntimeProvisioner {
  preflight(skill: InstalledSkill): Promise<ProvisionPlan>;
  provision(skill: InstalledSkill): Promise<ProvisionLog[]>;
  provisionStream(skill: InstalledSkill): AsyncGenerator<ProvisionLog>;
  reprovision(skill: InstalledSkill): Promise<ProvisionLog[]>;
  healthCheck(skillDir: string, runtime: SkillRuntimeDecl): Promise<boolean>;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function execPromise(
  binary: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer: 4 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${binary} ${args.join(" ")} failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function writeManagedMeta(skillDir: string, meta: ManagedMeta): Promise<void> {
  const metaPath = join(skillDir, ".managed_meta.json");
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export async function readManagedMeta(skillDir: string): Promise<ManagedMeta | null> {
  const metaPath = join(skillDir, ".managed_meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw) as ManagedMeta;
  } catch {
    return null;
  }
}

export function createRuntimeProvisioner(): RuntimeProvisioner {
  async function ensurePythonAvailable(skillName: string): Promise<void> {
    try {
      await execPromise("python3", ["--version"], { timeout: 10_000 });
    } catch {
      throw new Error(`python3 is not available on host, cannot provision skill "${skillName}"`);
    }
  }

  async function validatePythonEntrypoint(skill: InstalledSkill, skillDir: string): Promise<void> {
    if (skill.skill.source.handler !== "python-script") {
      return;
    }

    const entrypoint = skill.skill.source.handlerConfig?.entrypoint;
    if (typeof entrypoint !== "string" || entrypoint.trim() === "") {
      throw new Error("python-script handler requires handlerConfig.entrypoint");
    }

    const entrypointPath = join(skillDir, entrypoint);
    if (!(await fileExists(entrypointPath))) {
      throw new Error(`python-script entrypoint not found: ${entrypoint}`);
    }
  }

  async function* provisionPython(skill: InstalledSkill): AsyncGenerator<ProvisionLog> {
    const runtime = skill.skill.source.runtime;
    if (!runtime) {
      throw new Error(`Skill "${skill.skill.source.name}" has no runtime declaration`);
    }
    if (runtime.type !== "python") {
      throw new Error(`Runtime type "${runtime.type}" is not yet supported`);
    }

    const skillDir = dirname(skill.skill.source.filePath);
    const venvPath = join(skillDir, ".venv");

    const emit = (level: ProvisionLog["level"], message: string): ProvisionLog => ({
      level,
      message,
      timestamp: Date.now(),
    });

    try {
      await ensurePythonAvailable(skill.skill.source.name);
      await validatePythonEntrypoint(skill, skillDir);

      if (!(await fileExists(venvPath))) {
        yield emit("info", "Creating Python virtual environment...");
        await execPromise("python3", ["-m", "venv", venvPath], { cwd: skillDir, timeout: 60_000 });
        yield emit("info", "Virtual environment created");
      } else {
        yield emit("info", "Virtual environment already exists");
      }

      const pipBin = join(venvPath, "bin", "python");
      yield emit("info", "Upgrading pip...");
      await execPromise(pipBin, ["-m", "pip", "install", "--upgrade", "pip"], {
        cwd: skillDir,
        timeout: 60_000,
      });
      yield emit("info", "pip upgraded");

      if (runtime.dependencies.length > 0) {
        yield emit("info", `Installing dependencies: ${runtime.dependencies.join(", ")}...`);
        await execPromise(pipBin, ["-m", "pip", "install", ...runtime.dependencies], {
          cwd: skillDir,
          timeout: 300_000,
        });
        yield emit("info", "Dependencies installed");
      }

      for (const dep of runtime.dependencies) {
        const moduleName = dep.split("[")[0].split(">=")[0].split("==")[0].split("<")[0].trim();
        try {
          await execPromise(pipBin, ["-c", `import ${moduleName.replace(/-/g, "_")}`], {
            cwd: skillDir,
            timeout: 30_000,
          });
          yield emit("info", `Verified import: ${moduleName}`);
        } catch {
          yield emit("warn", `Could not verify import: ${moduleName} (may use different module name)`);
        }
      }

      const entrypoint =
        typeof skill.skill.source.handlerConfig?.entrypoint === "string"
          ? skill.skill.source.handlerConfig.entrypoint
          : undefined;

      await writeManagedMeta(skillDir, {
        schemaVersion: 1,
        runtime: runtime.type,
        dependencies: runtime.dependencies,
        entrypoint,
        status: "ready",
        updatedAt: new Date().toISOString(),
      });

      yield emit("info", "Provision completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await writeManagedMeta(skillDir, {
        schemaVersion: 1,
        runtime: runtime.type,
        dependencies: runtime.dependencies,
        status: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      });

      yield emit("error", `Provision failed: ${errorMessage}`);
      throw error;
    }
  }

  async function* reprovisionPython(skill: InstalledSkill): AsyncGenerator<ProvisionLog> {
    const runtime = skill.skill.source.runtime;
    if (!runtime) {
      throw new Error(`Skill "${skill.skill.source.name}" has no runtime declaration`);
    }
    if (runtime.type !== "python") {
      throw new Error(`Runtime type "${runtime.type}" is not yet supported`);
    }

    const skillDir = dirname(skill.skill.source.filePath);
    const venvPath = join(skillDir, ".venv");
    const metaPath = join(skillDir, ".managed_meta.json");

    yield { level: "info", message: "Reprovision requested: cleaning previous runtime...", timestamp: Date.now() };
    await rm(venvPath, { recursive: true, force: true });
    await rm(metaPath, { force: true });
    yield { level: "info", message: "Previous runtime cleaned", timestamp: Date.now() };

    yield* provisionPython(skill);
  }

  return {
    async preflight(skill) {
      const runtime = skill.skill.source.runtime;
      if (!runtime) {
        throw new Error(`Skill "${skill.skill.source.name}" has no runtime declaration`);
      }

      if (runtime.type !== "python") {
        throw new Error(`Runtime type "${runtime.type}" is not yet supported`);
      }

      const skillDir = dirname(skill.skill.source.filePath);
      await ensurePythonAvailable(skill.skill.source.name);
      await validatePythonEntrypoint(skill, skillDir);

      const venvPath = join(skillDir, ".venv");
      const steps: string[] = [];

      if (!(await fileExists(venvPath))) {
        steps.push("python3 -m venv .venv");
      }
      steps.push(".venv/bin/python -m pip install --upgrade pip");
      if (runtime.dependencies.length > 0) {
        steps.push(`.venv/bin/python -m pip install ${runtime.dependencies.join(" ")}`);
      }
      steps.push("Verify imports");

      return {
        runtime: runtime.type,
        steps,
        dependencies: runtime.dependencies,
      };
    },

    async provision(skill) {
      const logs: ProvisionLog[] = [];
      for await (const log of provisionPython(skill)) {
        logs.push(log);
      }
      return logs;
    },

    provisionStream(skill) {
      return provisionPython(skill);
    },

    async reprovision(skill) {
      const logs: ProvisionLog[] = [];
      for await (const log of reprovisionPython(skill)) {
        logs.push(log);
      }
      return logs;
    },

    async healthCheck(skillDir, runtime) {
      if (runtime.type !== "python") return false;

      const pythonBin = join(skillDir, ".venv", "bin", "python");
      if (!(await fileExists(pythonBin))) return false;

      try {
        await execPromise(pythonBin, ["--version"], { cwd: skillDir, timeout: 10_000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}
