import { execFile } from "node:child_process";
import { readFile, writeFile, stat, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  DetectedSkillRuntime,
  InstalledSkill,
  ProvisionStatus,
  SkillDependency,
  SkillProvisionInstaller,
  SkillRuntime,
} from "./types.js";

export interface ProvisionPlan {
  runtime: SkillRuntime;
  installer: SkillProvisionInstaller;
  createEnv: boolean;
  commandPreview: string[];
  dependencies: SkillDependency[];
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
  installer: SkillProvisionInstaller;
  status: ProvisionStatus;
  error?: string;
  updatedAt: string;
}

export interface RuntimeProvisioner {
  preflight(skill: InstalledSkill): Promise<ProvisionPlan>;
  provision(skill: InstalledSkill): Promise<ProvisionLog[]>;
  provisionStream(skill: InstalledSkill): AsyncGenerator<ProvisionLog>;
  reprovision(skill: InstalledSkill): Promise<ProvisionLog[]>;
  healthCheck(skill: InstalledSkill): Promise<boolean>;
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

function requirePythonSkill(skill: InstalledSkill): DetectedSkillRuntime & { kind: "python-script" | "python-script-set" } {
  const detected = skill.skill.detectedRuntime;
  if (!detected || (detected.kind !== "python-script" && detected.kind !== "python-script-set")) {
    throw new Error(`Skill "${skill.skill.source.name}" is not an auto-provisionable Python skill`);
  }
  return detected as DetectedSkillRuntime & { kind: "python-script" | "python-script-set" };
}

function requireNodeSkill(skill: InstalledSkill): DetectedSkillRuntime & { kind: "node-script" | "node-script-set" } {
  const detected = skill.skill.detectedRuntime;
  if (!detected || (detected.kind !== "node-script" && detected.kind !== "node-script-set")) {
    throw new Error(`Skill "${skill.skill.source.name}" is not an auto-provisionable Node skill`);
  }
  return detected as DetectedSkillRuntime & { kind: "node-script" | "node-script-set" };
}

function getSkillDir(skill: InstalledSkill): string {
  return resolve(dirname(skill.skill.source.filePath));
}

function getDependencySpecs(dependencies: SkillDependency[]): string[] {
  return dependencies.map((dependency) => dependency.installSpec ?? dependency.name);
}

export function createRuntimeProvisioner(): RuntimeProvisioner {
  async function ensurePythonAvailable(skillName: string): Promise<void> {
    try {
      await execPromise("python3", ["--version"], { timeout: 10_000 });
    } catch {
      throw new Error(`python3 is not available on host, cannot provision skill "${skillName}"`);
    }
  }

  async function ensureNodeAvailable(skillName: string): Promise<void> {
    try {
      await execPromise("node", ["--version"], { timeout: 10_000 });
    } catch {
      throw new Error(`node is not available on host, cannot provision skill "${skillName}"`);
    }
  }

  async function ensureUvAvailable(): Promise<boolean> {
    try {
      await execPromise("uv", ["--version"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async function validatePythonEntrypoint(skill: InstalledSkill): Promise<void> {
    const detected = requirePythonSkill(skill);
    if (!detected.entrypoint) return; // script-set: no entrypoint to validate
    const skillDir = getSkillDir(skill);
    const entrypointPath = join(skillDir, detected.entrypoint.path);
    if (!(await fileExists(entrypointPath))) {
      throw new Error(`python entrypoint not found: ${detected.entrypoint.path}`);
    }
  }

  async function validateNodeEntrypoint(skill: InstalledSkill): Promise<void> {
    const detected = requireNodeSkill(skill);
    if (!detected.entrypoint) return; // script-set: no entrypoint to validate
    const skillDir = getSkillDir(skill);
    const entrypointPath = join(skillDir, detected.entrypoint.path);
    if (!(await fileExists(entrypointPath))) {
      throw new Error(`node entrypoint not found: ${detected.entrypoint.path}`);
    }
  }

  async function buildInstallCommands(skill: InstalledSkill): Promise<{
    installer: SkillProvisionInstaller;
    commands: string[];
    runInstall: (venvPath: string, skillDir: string, dependencies: string[]) => Promise<void>;
  }> {
    const detected = requirePythonSkill(skill);
    const dependencies = getDependencySpecs(detected.dependencies);
    const prefersUv = detected.preferredInstaller === "uv-pip" && await ensureUvAvailable();
    const entrypointPath = detected.entrypoint?.path;

    if (prefersUv) {
      return {
        installer: "uv-pip",
        commands: [
          "python3 -m venv .venv",
          ...(
            dependencies.length > 0
              ? [`uv pip install --python .venv/bin/python ${dependencies.join(" ")}`]
              : []
          ),
          ...(entrypointPath ? [`.venv/bin/python -m py_compile ${entrypointPath}`] : []),
        ],
        async runInstall(venvPath, skillDir, deps) {
          if (deps.length > 0) {
            await execPromise("uv", ["pip", "install", "--python", join(venvPath, "bin", "python"), ...deps], {
              cwd: skillDir,
              timeout: 300_000,
            });
          }
        },
      };
    }

    return {
      installer: "pip",
      commands: [
        "python3 -m venv .venv",
        ".venv/bin/python -m pip install --upgrade pip",
        ...(dependencies.length > 0 ? [`.venv/bin/python -m pip install ${dependencies.join(" ")}`] : []),
        ...(entrypointPath ? [`.venv/bin/python -m py_compile ${entrypointPath}`] : []),
      ],
      async runInstall(venvPath, skillDir, deps) {
        const pythonBin = join(venvPath, "bin", "python");
        await execPromise(pythonBin, ["-m", "pip", "install", "--upgrade", "pip"], {
          cwd: skillDir,
          timeout: 60_000,
        });
        if (deps.length > 0) {
          await execPromise(pythonBin, ["-m", "pip", "install", ...deps], {
            cwd: skillDir,
            timeout: 300_000,
          });
        }
      },
    };
  }

  async function ensureBinaryAvailable(binary: "npm" | "pnpm" | "yarn"): Promise<boolean> {
    try {
      await execPromise(binary, ["--version"], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  async function buildNodeInstallCommands(skill: InstalledSkill): Promise<{
    installer: SkillProvisionInstaller;
    commands: string[];
    runInstall: (skillDir: string, dependencies: string[]) => Promise<void>;
  }> {
    const detected = requireNodeSkill(skill);
    const dependencies = getDependencySpecs(detected.dependencies);
    const preferred = detected.preferredInstaller;
    const entrypointPath = detected.entrypoint?.path;
    let installer: SkillProvisionInstaller = "npm";
    if ((preferred === "pnpm" || preferred === "yarn") && await ensureBinaryAvailable(preferred)) {
      installer = preferred;
    }
    if (installer === "npm" && !(await ensureBinaryAvailable("npm"))) {
      throw new Error("npm is not available on host");
    }

    if (installer === "pnpm") {
      return {
        installer,
        commands: [
          ...(dependencies.length > 0 ? [`pnpm add --dir . ${dependencies.join(" ")}`] : []),
          ...(entrypointPath ? [`node --check ${entrypointPath}`] : []),
        ],
        async runInstall(skillDir, deps) {
          if (deps.length > 0) {
            await execPromise("pnpm", ["add", "--dir", ".", ...deps], {
              cwd: skillDir,
              timeout: 300_000,
            });
          }
        },
      };
    }

    if (installer === "yarn") {
      return {
        installer,
        commands: [
          ...(dependencies.length > 0 ? [`yarn add ${dependencies.join(" ")}`] : []),
          ...(entrypointPath ? [`node --check ${entrypointPath}`] : []),
        ],
        async runInstall(skillDir, deps) {
          if (deps.length > 0) {
            await execPromise("yarn", ["add", ...deps], {
              cwd: skillDir,
              timeout: 300_000,
            });
          }
        },
      };
    }

    return {
      installer: "npm",
      commands: [
        ...(dependencies.length > 0 ? [`npm install --no-save --no-package-lock ${dependencies.join(" ")}`] : []),
        ...(entrypointPath ? [`node --check ${entrypointPath}`] : []),
      ],
      async runInstall(skillDir, deps) {
        if (deps.length > 0) {
          await execPromise("npm", ["install", "--no-save", "--no-package-lock", ...deps], {
            cwd: skillDir,
            timeout: 300_000,
          });
        }
      },
    };
  }

  async function verifyPythonEntrypoint(skill: InstalledSkill): Promise<void> {
    const detected = requirePythonSkill(skill);
    if (!detected.entrypoint) return; // script-set: nothing to verify
    const skillDir = getSkillDir(skill);
    const pythonBin = join(skillDir, ".venv", "bin", "python");
    await execPromise(pythonBin, ["-m", "py_compile", detected.entrypoint.path], {
      cwd: skillDir,
      timeout: 30_000,
    });
  }

  async function verifyNodeEntrypoint(skill: InstalledSkill): Promise<void> {
    const detected = requireNodeSkill(skill);
    if (!detected.entrypoint) return; // script-set: nothing to verify
    const skillDir = getSkillDir(skill);
    await execPromise("node", ["--check", detected.entrypoint.path], {
      cwd: skillDir,
      timeout: 30_000,
    });
  }

  async function* provisionPython(skill: InstalledSkill): AsyncGenerator<ProvisionLog> {
    const detected = requirePythonSkill(skill);
    const skillDir = getSkillDir(skill);
    const venvPath = join(skillDir, ".venv");
    const dependencies = getDependencySpecs(detected.dependencies);

    const emit = (level: ProvisionLog["level"], message: string): ProvisionLog => ({
      level,
      message,
      timestamp: Date.now(),
    });

    try {
      await ensurePythonAvailable(skill.skill.source.name);
      await validatePythonEntrypoint(skill);

      if (!(await fileExists(venvPath))) {
        yield emit("info", "Creating Python virtual environment...");
        await execPromise("python3", ["-m", "venv", venvPath], { cwd: skillDir, timeout: 60_000 });
        yield emit("info", "Virtual environment created");
      } else {
        yield emit("info", "Virtual environment already exists");
      }

      const installCommands = await buildInstallCommands(skill);
      if (dependencies.length > 0) {
        yield emit("info", `Installing dependencies with ${installCommands.installer}: ${dependencies.join(", ")}...`);
        await installCommands.runInstall(venvPath, skillDir, dependencies);
        yield emit("info", "Dependencies installed");
      } else if (installCommands.installer === "pip") {
        const pythonBin = join(venvPath, "bin", "python");
        yield emit("info", "Upgrading pip...");
        await execPromise(pythonBin, ["-m", "pip", "install", "--upgrade", "pip"], {
          cwd: skillDir,
          timeout: 60_000,
        });
        yield emit("info", "pip upgraded");
      }

      if (detected.entrypoint) {
        yield emit("info", `Verifying entrypoint: ${detected.entrypoint.path}`);
        await verifyPythonEntrypoint(skill);
        yield emit("info", "Entrypoint verification passed");
      } else {
        yield emit("info", "Script-set skill: skipping entrypoint verification");
      }

      await writeManagedMeta(skillDir, {
        schemaVersion: 1,
        runtime: "python",
        dependencies,
        entrypoint: detected.entrypoint?.path,
        installer: installCommands.installer,
        status: "ready",
        updatedAt: new Date().toISOString(),
      });

      yield emit("info", "Provision completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await writeManagedMeta(skillDir, {
        schemaVersion: 1,
        runtime: "python",
        dependencies,
        entrypoint: detected.entrypoint?.path,
        installer: detected.preferredInstaller,
        status: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      });

      yield emit("error", `Provision failed: ${errorMessage}`);
      throw error;
    }
  }

  async function* reprovisionPython(skill: InstalledSkill): AsyncGenerator<ProvisionLog> {
    const skillDir = getSkillDir(skill);
    const venvPath = join(skillDir, ".venv");
    const metaPath = join(skillDir, ".managed_meta.json");

    yield { level: "info", message: "Reprovision requested: cleaning previous runtime...", timestamp: Date.now() };
    await rm(venvPath, { recursive: true, force: true });
    await rm(metaPath, { force: true });
    yield { level: "info", message: "Previous runtime cleaned", timestamp: Date.now() };

    yield* provisionPython(skill);
  }

  async function* provisionNode(skill: InstalledSkill): AsyncGenerator<ProvisionLog> {
    const detected = requireNodeSkill(skill);
    const skillDir = getSkillDir(skill);
    const dependencies = getDependencySpecs(detected.dependencies);

    const emit = (level: ProvisionLog["level"], message: string): ProvisionLog => ({
      level,
      message,
      timestamp: Date.now(),
    });

    try {
      await ensureNodeAvailable(skill.skill.source.name);
      await validateNodeEntrypoint(skill);

      const installCommands = await buildNodeInstallCommands(skill);
      if (dependencies.length > 0) {
        yield emit("info", `Installing dependencies with ${installCommands.installer}: ${dependencies.join(", ")}...`);
        await installCommands.runInstall(skillDir, dependencies);
        yield emit("info", "Dependencies installed");
      } else {
        yield emit("info", "No Node dependencies detected; skipping install step");
      }

      if (detected.entrypoint) {
        yield emit("info", `Verifying entrypoint: ${detected.entrypoint.path}`);
        await verifyNodeEntrypoint(skill);
        yield emit("info", "Entrypoint verification passed");
      } else {
        yield emit("info", "Script-set skill: skipping entrypoint verification");
      }

      await writeManagedMeta(skillDir, {
        schemaVersion: 1,
        runtime: "node",
        dependencies,
        entrypoint: detected.entrypoint?.path,
        installer: installCommands.installer,
        status: "ready",
        updatedAt: new Date().toISOString(),
      });

      yield emit("info", "Provision completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await writeManagedMeta(skillDir, {
        schemaVersion: 1,
        runtime: "node",
        dependencies,
        entrypoint: detected.entrypoint?.path,
        installer: detected.preferredInstaller,
        status: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      });

      yield emit("error", `Provision failed: ${errorMessage}`);
      throw error;
    }
  }

  async function* reprovisionNode(skill: InstalledSkill): AsyncGenerator<ProvisionLog> {
    const skillDir = getSkillDir(skill);
    const metaPath = join(skillDir, ".managed_meta.json");

    yield { level: "info", message: "Reprovision requested: cleaning previous runtime...", timestamp: Date.now() };
    await rm(join(skillDir, "node_modules"), { recursive: true, force: true });
    await rm(metaPath, { force: true });
    yield { level: "info", message: "Previous runtime cleaned", timestamp: Date.now() };

    yield* provisionNode(skill);
  }

  return {
    async preflight(skill) {
      const detected = skill.skill.detectedRuntime;
      if (!detected || (detected.kind !== "python-script" && detected.kind !== "python-script-set" && detected.kind !== "node-script" && detected.kind !== "node-script-set")) {
        throw new Error(`Skill "${skill.skill.source.name}" does not have a provisionable runtime`);
      }

      if (detected.kind === "python-script" || detected.kind === "python-script-set") {
        const skillDir = getSkillDir(skill);
        await ensurePythonAvailable(skill.skill.source.name);
        await validatePythonEntrypoint(skill);

        const venvPath = join(skillDir, ".venv");
        const installCommands = await buildInstallCommands(skill);

        return {
          runtime: "python",
          installer: installCommands.installer,
          createEnv: !(await fileExists(venvPath)),
          commandPreview: installCommands.commands,
          dependencies: detected.dependencies,
        };
      }

      if (detected.kind === "node-script" || detected.kind === "node-script-set") {
        await ensureNodeAvailable(skill.skill.source.name);
        await validateNodeEntrypoint(skill);
        const installCommands = await buildNodeInstallCommands(skill);

        return {
          runtime: "node",
          installer: installCommands.installer,
          createEnv: false,
          commandPreview: installCommands.commands,
          dependencies: detected.dependencies,
        };
      }

      throw new Error(`Skill "${skill.skill.source.name}" does not have a provisionable runtime`);
    },

    async provision(skill) {
      const logs: ProvisionLog[] = [];
      const detected = skill.skill.detectedRuntime;
      const stream =
        detected?.kind === "python-script" || detected?.kind === "python-script-set"
          ? provisionPython(skill)
          : detected?.kind === "node-script" || detected?.kind === "node-script-set"
            ? provisionNode(skill)
            : null;
      if (!stream) {
        throw new Error(`Skill "${skill.skill.source.name}" does not have a provisionable runtime`);
      }
      for await (const log of stream) {
        logs.push(log);
      }
      return logs;
    },

    provisionStream(skill) {
      const detected = skill.skill.detectedRuntime;
      if (detected?.kind === "python-script" || detected?.kind === "python-script-set") {
        return provisionPython(skill);
      }
      if (detected?.kind === "node-script" || detected?.kind === "node-script-set") {
        return provisionNode(skill);
      }
      throw new Error(`Skill "${skill.skill.source.name}" does not have a provisionable runtime`);
    },

    async reprovision(skill) {
      const logs: ProvisionLog[] = [];
      const detected = skill.skill.detectedRuntime;
      const stream =
        detected?.kind === "python-script" || detected?.kind === "python-script-set"
          ? reprovisionPython(skill)
          : detected?.kind === "node-script" || detected?.kind === "node-script-set"
            ? reprovisionNode(skill)
            : null;
      if (!stream) {
        throw new Error(`Skill "${skill.skill.source.name}" does not have a provisionable runtime`);
      }
      for await (const log of stream) {
        logs.push(log);
      }
      return logs;
    },

    async healthCheck(skill) {
      const detected = skill.skill.detectedRuntime;
      if (!detected) {
        return false;
      }

      const skillDir = getSkillDir(skill);

      if (detected.kind === "python-script" || detected.kind === "python-script-set") {
        const pythonBin = join(skillDir, ".venv", "bin", "python");
        if (!(await fileExists(pythonBin))) return false;

        if (detected.entrypoint) {
          if (!(await fileExists(join(skillDir, detected.entrypoint.path)))) return false;
          try {
            await execPromise(pythonBin, ["-m", "py_compile", detected.entrypoint.path], {
              cwd: skillDir,
              timeout: 10_000,
            });
            return true;
          } catch {
            return false;
          }
        }
        // script-set: venv exists is sufficient
        return true;
      }

      if (detected.kind === "node-script" || detected.kind === "node-script-set") {
        if (detected.entrypoint) {
          if (!(await fileExists(join(skillDir, detected.entrypoint.path)))) return false;
          try {
            await execPromise("node", ["--check", detected.entrypoint.path], {
              cwd: skillDir,
              timeout: 10_000,
            });
            return true;
          } catch {
            return false;
          }
        }
        // script-set: check managed meta existence
        const meta = await readManagedMeta(skillDir);
        return meta?.status === "ready";
      }

      return false;
    },
  };
}
