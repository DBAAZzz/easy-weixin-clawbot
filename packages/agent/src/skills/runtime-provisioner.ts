import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execPromise, isFile, pathExists } from "./fs-utils.js";
import type {
  DetectedSkillRuntime,
  InstalledSkill,
  ProvisionStatus,
  ProvisionableKind,
  SkillDependency,
  SkillProvisionInstaller,
  SkillRuntime,
} from "./types.js";
import {
  isProvisionableKind,
  isPythonKind,
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

interface InstallPlan {
  installer: SkillProvisionInstaller;
  commands: string[];
  runInstall(skillDir: string, deps: string[]): Promise<void>;
  runEmptyInstall?(skillDir: string): AsyncGenerator<ProvisionLog>;
}

interface RuntimeAdapter {
  readonly runtime: SkillRuntime;
  readonly artifactPath: string | null;
  ensureToolchain(skillName: string): Promise<void>;
  prepareEnv(skillDir: string): AsyncGenerator<ProvisionLog>;
  validateEntrypoint(skill: InstalledSkill, skillDir: string): Promise<void>;
  verifyEntrypoint(skill: InstalledSkill, skillDir: string): Promise<void>;
  buildInstall(skill: InstalledSkill): Promise<InstallPlan>;
  cleanArtifacts(skillDir: string): Promise<void>;
  healthCheck(skill: InstalledSkill, skillDir: string): Promise<boolean>;
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

function getSkillDir(skill: InstalledSkill): string {
  return resolve(dirname(skill.skill.source.filePath));
}

function getDependencySpecs(dependencies: SkillDependency[]): string[] {
  return dependencies.map((dependency) => dependency.installSpec ?? dependency.name);
}

function requireProvisionableRuntime(skill: InstalledSkill): DetectedSkillRuntime & { kind: ProvisionableKind } {
  const detected = skill.skill.detectedRuntime;
  if (!isProvisionableKind(detected?.kind)) {
    throw new Error(`Skill "${skill.skill.source.name}" does not have a provisionable runtime`);
  }
  return detected as DetectedSkillRuntime & { kind: ProvisionableKind };
}

function selectAdapter(kind: ProvisionableKind): RuntimeAdapter {
  return isPythonKind(kind) ? pythonAdapter : nodeAdapter;
}

function emit(level: ProvisionLog["level"], message: string): ProvisionLog {
  return { level, message, timestamp: Date.now() };
}

async function ensureBinaryAvailable(binary: string): Promise<boolean> {
  try {
    await execPromise(binary, ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function ensureEntrypointExists(
  skill: InstalledSkill,
  skillDir: string,
  runtime: SkillRuntime,
): Promise<void> {
  const detected = requireProvisionableRuntime(skill);
  if (!detected.entrypoint) return;
  if (!(await isFile(join(skillDir, detected.entrypoint.path)))) {
    throw new Error(`${runtime} entrypoint not found: ${detected.entrypoint.path}`);
  }
}

const pythonAdapter: RuntimeAdapter = {
  runtime: "python",
  artifactPath: ".venv",

  async ensureToolchain(skillName) {
    if (!(await ensureBinaryAvailable("python3"))) {
      throw new Error(`python3 is not available on host, cannot provision skill "${skillName}"`);
    }
  },

  validateEntrypoint(skill, skillDir) {
    return ensureEntrypointExists(skill, skillDir, "python");
  },

  async *prepareEnv(skillDir) {
    const venvPath = join(skillDir, ".venv");
    if (!(await pathExists(venvPath))) {
      yield emit("info", "Creating Python virtual environment...");
      await execPromise("python3", ["-m", "venv", venvPath], { cwd: skillDir, timeout: 60_000 });
      yield emit("info", "Virtual environment created");
      return;
    }

    yield emit("info", "Virtual environment already exists");
  },

  async verifyEntrypoint(skill, skillDir) {
    const detected = requireProvisionableRuntime(skill);
    if (!detected.entrypoint) return;
    const pythonBin = join(skillDir, ".venv", "bin", "python");
    await execPromise(pythonBin, ["-m", "py_compile", detected.entrypoint.path], {
      cwd: skillDir,
      timeout: 30_000,
    });
  },

  async buildInstall(skill) {
    const detected = requireProvisionableRuntime(skill);
    const dependencies = getDependencySpecs(detected.dependencies);
    const prefersUv = detected.preferredInstaller === "uv-pip" && await ensureBinaryAvailable("uv");
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
        async runInstall(skillDir, deps) {
          if (deps.length > 0) {
            await execPromise("uv", ["pip", "install", "--python", join(skillDir, ".venv", "bin", "python"), ...deps], {
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
      async runInstall(skillDir, deps) {
        const pythonBin = join(skillDir, ".venv", "bin", "python");
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
      async *runEmptyInstall(skillDir) {
        const pythonBin = join(skillDir, ".venv", "bin", "python");
        yield emit("info", "Upgrading pip...");
        await execPromise(pythonBin, ["-m", "pip", "install", "--upgrade", "pip"], {
          cwd: skillDir,
          timeout: 60_000,
        });
        yield emit("info", "pip upgraded");
      },
    };
  },

  async cleanArtifacts(skillDir) {
    await rm(join(skillDir, ".venv"), { recursive: true, force: true });
  },

  async healthCheck(skill, skillDir) {
    const detected = requireProvisionableRuntime(skill);
    const pythonBin = join(skillDir, ".venv", "bin", "python");
    if (!(await isFile(pythonBin))) return false;

    if (!detected.entrypoint) {
      return true;
    }
    if (!(await isFile(join(skillDir, detected.entrypoint.path)))) {
      return false;
    }
    try {
      await execPromise(pythonBin, ["-m", "py_compile", detected.entrypoint.path], {
        cwd: skillDir,
        timeout: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  },
};

const nodeAdapter: RuntimeAdapter = {
  runtime: "node",
  artifactPath: null,

  async ensureToolchain(skillName) {
    if (!(await ensureBinaryAvailable("node"))) {
      throw new Error(`node is not available on host, cannot provision skill "${skillName}"`);
    }
  },

  validateEntrypoint(skill, skillDir) {
    return ensureEntrypointExists(skill, skillDir, "node");
  },

  async *prepareEnv() {},

  async verifyEntrypoint(skill, skillDir) {
    const detected = requireProvisionableRuntime(skill);
    if (!detected.entrypoint) return;
    await execPromise("node", ["--check", detected.entrypoint.path], {
      cwd: skillDir,
      timeout: 30_000,
    });
  },

  async buildInstall(skill) {
    const detected = requireProvisionableRuntime(skill);
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
        async *runEmptyInstall() {
          yield emit("info", "No Node dependencies detected; skipping install step");
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
        async *runEmptyInstall() {
          yield emit("info", "No Node dependencies detected; skipping install step");
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
      async *runEmptyInstall() {
        yield emit("info", "No Node dependencies detected; skipping install step");
      },
    };
  },

  async cleanArtifacts(skillDir) {
    await rm(join(skillDir, "node_modules"), { recursive: true, force: true });
  },

  async healthCheck(skill, skillDir) {
    const detected = requireProvisionableRuntime(skill);
    if (!detected.entrypoint) {
      const meta = await readManagedMeta(skillDir);
      return meta?.status === "ready";
    }
    if (!(await isFile(join(skillDir, detected.entrypoint.path)))) {
      return false;
    }
    try {
      await execPromise("node", ["--check", detected.entrypoint.path], {
        cwd: skillDir,
        timeout: 10_000,
      });
      return true;
    } catch {
      return false;
    }
  },
};

async function createProvisionPlan(
  skill: InstalledSkill,
  adapter: RuntimeAdapter,
  detected: DetectedSkillRuntime & { kind: ProvisionableKind },
): Promise<ProvisionPlan> {
  const skillDir = getSkillDir(skill);
  const installPlan = await adapter.buildInstall(skill);
  const artifactPath = adapter.artifactPath ? join(skillDir, adapter.artifactPath) : null;

  return {
    runtime: adapter.runtime,
    installer: installPlan.installer,
    createEnv: artifactPath ? !(await pathExists(artifactPath)) : false,
    commandPreview: installPlan.commands,
    dependencies: detected.dependencies,
  };
}

async function* provisionWithAdapter(
  skill: InstalledSkill,
  adapter: RuntimeAdapter,
  detected: DetectedSkillRuntime & { kind: ProvisionableKind },
): AsyncGenerator<ProvisionLog> {
  const skillDir = getSkillDir(skill);
  const dependencies = getDependencySpecs(detected.dependencies);

  try {
    await adapter.ensureToolchain(skill.skill.source.name);
    await adapter.validateEntrypoint(skill, skillDir);
    yield* adapter.prepareEnv(skillDir);

    const installPlan = await adapter.buildInstall(skill);
    if (dependencies.length > 0) {
      yield emit("info", `Installing dependencies with ${installPlan.installer}: ${dependencies.join(", ")}...`);
      await installPlan.runInstall(skillDir, dependencies);
      yield emit("info", "Dependencies installed");
    } else if (installPlan.runEmptyInstall) {
      yield* installPlan.runEmptyInstall(skillDir);
    }

    if (detected.entrypoint) {
      yield emit("info", `Verifying entrypoint: ${detected.entrypoint.path}`);
      await adapter.verifyEntrypoint(skill, skillDir);
      yield emit("info", "Entrypoint verification passed");
    } else {
      yield emit("info", "Script-set skill: skipping entrypoint verification");
    }

    await writeManagedMeta(skillDir, {
      schemaVersion: 1,
      runtime: adapter.runtime,
      dependencies,
      entrypoint: detected.entrypoint?.path,
      installer: installPlan.installer,
      status: "ready",
      updatedAt: new Date().toISOString(),
    });

    yield emit("info", "Provision completed successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await writeManagedMeta(skillDir, {
      schemaVersion: 1,
      runtime: adapter.runtime,
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

async function* reprovisionWithAdapter(
  skill: InstalledSkill,
  adapter: RuntimeAdapter,
  detected: DetectedSkillRuntime & { kind: ProvisionableKind },
): AsyncGenerator<ProvisionLog> {
  const skillDir = getSkillDir(skill);

  yield emit("info", "Reprovision requested: cleaning previous runtime...");
  await adapter.cleanArtifacts(skillDir);
  await rm(join(skillDir, ".managed_meta.json"), { force: true });
  yield emit("info", "Previous runtime cleaned");

  yield* provisionWithAdapter(skill, adapter, detected);
}

async function collectLogs(stream: AsyncGenerator<ProvisionLog>): Promise<ProvisionLog[]> {
  const logs: ProvisionLog[] = [];
  for await (const log of stream) {
    logs.push(log);
  }
  return logs;
}

export function createRuntimeProvisioner(): RuntimeProvisioner {
  return {
    async preflight(skill) {
      const detected = requireProvisionableRuntime(skill);
      const adapter = selectAdapter(detected.kind);
      const skillDir = getSkillDir(skill);
      await adapter.ensureToolchain(skill.skill.source.name);
      await adapter.validateEntrypoint(skill, skillDir);
      return createProvisionPlan(skill, adapter, detected);
    },

    provision(skill) {
      const detected = requireProvisionableRuntime(skill);
      return collectLogs(provisionWithAdapter(skill, selectAdapter(detected.kind), detected));
    },

    provisionStream(skill) {
      const detected = requireProvisionableRuntime(skill);
      return provisionWithAdapter(skill, selectAdapter(detected.kind), detected);
    },

    async reprovision(skill) {
      const detected = requireProvisionableRuntime(skill);
      return collectLogs(reprovisionWithAdapter(skill, selectAdapter(detected.kind), detected));
    },

    async healthCheck(skill) {
      const detected = skill.skill.detectedRuntime;
      if (!isProvisionableKind(detected?.kind)) {
        return false;
      }
      return selectAdapter(detected.kind).healthCheck(skill, getSkillDir(skill));
    },
  };
}
