import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseMdContent } from "../shared/parser.js";
import { compileSkill, createSkillSource } from "./compiler.js";
import { loadSkillsFromDirectory } from "./loader.js";
import { scanSkillPackage } from "./package-scanner.js";
import { detectSkillRuntime } from "./runtime-detector.js";
import type {
  CompiledSkill,
  DetectedSkillRuntime,
  InstalledSkill,
  ProvisionStatus,
  SkillCatalogItem,
  SkillInstaller,
  SkillInstallerResult,
  SkillRegistry,
  SkillSnapshot,
} from "./types.js";

interface InstallerState {
  items: Record<
    string,
    {
      enabled?: boolean;
      installedAt?: string;
      provisionStatus?: ProvisionStatus;
      provisionError?: string;
    }
  >;
}

function getStatePath(userDir: string): string {
  return join(dirname(userDir), "state.json");
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readState(statePath: string): Promise<InstallerState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as InstallerState;
    return parsed && typeof parsed === "object" && parsed.items ? parsed : { items: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { items: {} };
    }
    throw error;
  }
}

async function writeState(statePath: string, state: InstallerState): Promise<void> {
  await ensureDir(dirname(statePath));
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function shouldTrackProvisionStatus(runtime: DetectedSkillRuntime | undefined): boolean {
  return runtime?.kind === "python-script" || runtime?.kind === "node-script";
}

function toCatalogItem(installed: InstalledSkill): SkillCatalogItem {
  const runtimeKind = installed.skill.detectedRuntime?.kind ?? "knowledge-only";

  return {
    name: installed.skill.source.name,
    summary: installed.skill.source.summary,
    version: installed.skill.source.version,
    author: installed.skill.source.author,
    type: "skill",
    activation: installed.skill.source.activation,
    origin: installed.origin,
    enabled: installed.enabled,
    installedAt: installed.installedAt,
    filePath: installed.skill.source.filePath,
    runtimeKind,
    entrypointPath: installed.skill.detectedRuntime?.entrypoint?.path,
    dependencyNames: installed.skill.detectedRuntime?.dependencies.map((dependency) => dependency.name) ?? [],
    hasRuntime: runtimeKind !== "knowledge-only",
    provisionStatus: installed.provisionStatus,
    provisionError: installed.provisionError,
  };
}

function buildSnapshot(installed: InstalledSkill[]): SkillSnapshot {
  const enabled = installed
    .filter((item) => item.enabled)
    .sort((left, right) => left.skill.source.name.localeCompare(right.skill.source.name));

  return {
    alwaysOn: enabled
      .filter((item) => item.skill.source.activation === "always")
      .map((item) => ({
        name: item.skill.source.name,
        body: item.skill.source.body,
      })),
    index: enabled
      .filter((item) => item.skill.source.activation === "on-demand")
      .map((item) => ({
        name: item.skill.source.name,
        summary: item.skill.source.summary,
      })),
    onDemand: new Map(
      enabled
        .filter((item) => item.skill.source.activation === "on-demand")
        .map((item) => [item.skill.source.name, item.skill] as const),
    ),
  };
}

export function createSkillInstaller(registry: SkillRegistry): SkillInstaller {
  let builtinDir = "";
  let userDir = "";
  let statePath = "";
  let state: InstallerState = { items: {} };
  let installed = new Map<string, InstalledSkill>();

  async function enrichCompiledSkill(compiled: CompiledSkill): Promise<CompiledSkill> {
    const rootDir = dirname(compiled.source.filePath);
    const packageIndex = await scanSkillPackage(rootDir);
    const detectedRuntime = await detectSkillRuntime(compiled, packageIndex);
    return {
      ...compiled,
      packageIndex,
      detectedRuntime,
    };
  }

  async function buildInstalledSkill(
    compiled: CompiledSkill,
    origin: "builtin" | "user",
    now: string,
  ): Promise<InstalledSkill> {
    const enriched = await enrichCompiledSkill(compiled);
    const previous = state.items[enriched.source.name] ?? {};
    const shouldTrackProvision = shouldTrackProvisionStatus(enriched.detectedRuntime);

    state.items[enriched.source.name] = {
      enabled: previous.enabled ?? true,
      installedAt: previous.installedAt ?? now,
      provisionStatus: shouldTrackProvision ? (previous.provisionStatus ?? "pending") : undefined,
      provisionError: shouldTrackProvision ? previous.provisionError : undefined,
    };

    return {
      skill: enriched,
      origin,
      enabled: state.items[enriched.source.name].enabled ?? true,
      installedAt: state.items[enriched.source.name].installedAt ?? now,
      provisionStatus: state.items[enriched.source.name].provisionStatus,
      provisionError: state.items[enriched.source.name].provisionError,
    };
  }

  async function rebuild(): Promise<SkillInstallerResult> {
    const builtin = await loadSkillsFromDirectory(builtinDir);
    const user = await loadSkillsFromDirectory(userDir);
    const next = new Map<string, InstalledSkill>();
    const now = new Date().toISOString();

    for (const compiled of builtin.skills) {
      const item = await buildInstalledSkill(compiled, "builtin", now);
      next.set(item.skill.source.name, item);
    }

    for (const compiled of user.skills) {
      const item = await buildInstalledSkill(compiled, "user", now);
      next.set(item.skill.source.name, item);
    }

    for (const name of Object.keys(state.items)) {
      if (!next.has(name)) {
        delete state.items[name];
      }
    }

    installed = next;
    registry.swap(buildSnapshot([...installed.values()]));
    await writeState(statePath, state);

    return {
      loaded: [...installed.keys()].sort((left, right) => left.localeCompare(right)),
      failed: [...builtin.failed, ...user.failed],
    };
  }

  function requireInstalled(name: string): InstalledSkill {
    const item = installed.get(name);
    if (!item) {
      throw new Error(`Skill not found: ${name}`);
    }
    return item;
  }

  function requireCatalogItem(name: string): SkillCatalogItem {
    return toCatalogItem(requireInstalled(name));
  }

  async function parseInline(markdown: string, filePath: string) {
    const parsed = parseMdContent(markdown, filePath);
    return compileSkill(createSkillSource(parsed));
  }

  async function writeUserSkill(markdown: string, expectedName?: string): Promise<SkillCatalogItem> {
    await ensureDir(userDir);
    const compiled = await parseInline(markdown, join(userDir, "inline-SKILL.md"));
    if (expectedName && compiled.source.name !== expectedName) {
      throw new Error(`Skill name mismatch: expected "${expectedName}" but got "${compiled.source.name}"`);
    }

    const skillDir = join(userDir, compiled.source.name);
    await ensureDir(skillDir);
    const filePath = join(skillDir, "SKILL.md");
    await writeFile(filePath, markdown, "utf8");

    const previousState = state.items[compiled.source.name];
    state.items[compiled.source.name] = {
      enabled: previousState?.enabled ?? true,
      installedAt: previousState?.installedAt ?? new Date().toISOString(),
      provisionStatus: previousState?.provisionStatus,
      provisionError: previousState?.provisionError,
    };

    await rebuild();
    return requireCatalogItem(compiled.source.name);
  }

  async function installFromDirectory(sourceDir: string): Promise<SkillCatalogItem> {
    await ensureDir(userDir);
    const skillMdPath = join(sourceDir, "SKILL.md");
    if (!(await fileExists(skillMdPath))) {
      throw new Error("SKILL.md not found in the uploaded directory");
    }
    const markdown = await readFile(skillMdPath, "utf8");
    const compiled = await parseInline(markdown, skillMdPath);
    const name = compiled.source.name;

    const targetDir = join(userDir, name);
    if (await fileExists(targetDir)) {
      await rm(targetDir, { recursive: true });
    }
    await cp(sourceDir, targetDir, { recursive: true });

    const previousState = state.items[name];
    state.items[name] = {
      enabled: previousState?.enabled ?? true,
      installedAt: previousState?.installedAt ?? new Date().toISOString(),
      provisionStatus: previousState?.provisionStatus,
      provisionError: previousState?.provisionError,
    };

    await rebuild();
    return requireCatalogItem(name);
  }

  return {
    async initialize(nextBuiltinDir, nextUserDir) {
      builtinDir = nextBuiltinDir;
      userDir = nextUserDir;
      statePath = getStatePath(userDir);
      await ensureDir(userDir);
      state = await readState(statePath);
      return rebuild();
    },

    list() {
      return [...installed.values()]
        .map(toCatalogItem)
        .sort((left, right) => left.name.localeCompare(right.name));
    },

    get(name) {
      const item = installed.get(name);
      return item ? toCatalogItem(item) : null;
    },

    async getSource(name) {
      const item = installed.get(name);
      if (!item) {
        return null;
      }
      return readFile(item.skill.source.filePath, "utf8");
    },

    async validate(markdown) {
      const compiled = await parseInline(markdown, "<inline-skill>");
      return {
        name: compiled.source.name,
        summary: compiled.source.summary,
        version: compiled.source.version,
        author: compiled.source.author,
        type: "skill",
        activation: compiled.source.activation,
        origin: "user",
        enabled: true,
        installedAt: new Date().toISOString(),
        filePath: compiled.source.filePath,
        runtimeKind: "knowledge-only",
        dependencyNames: [],
        hasRuntime: false,
      };
    },

    install(markdown) {
      return writeUserSkill(markdown);
    },

    installDirectory(sourceDir) {
      return installFromDirectory(sourceDir);
    },

    update(name, markdown) {
      return writeUserSkill(markdown, name);
    },

    async remove(name) {
      const existing = requireInstalled(name);
      if (existing.origin !== "user") {
        throw new Error(`Builtin skill cannot be removed: ${name}`);
      }

      const skillDir = join(userDir, name);
      if (await fileExists(skillDir)) {
        await rm(skillDir, { recursive: true });
      }

      await rebuild();
    },

    async enable(name) {
      const existing = requireInstalled(name);
      state.items[name] = {
        enabled: true,
        installedAt: existing.installedAt,
        provisionStatus: existing.provisionStatus,
        provisionError: existing.provisionError,
      };
      await writeState(statePath, state);
      await rebuild();
      return requireCatalogItem(name);
    },

    async disable(name) {
      const existing = requireInstalled(name);
      state.items[name] = {
        enabled: false,
        installedAt: existing.installedAt,
        provisionStatus: existing.provisionStatus,
        provisionError: existing.provisionError,
      };
      await writeState(statePath, state);
      await rebuild();
      return requireCatalogItem(name);
    },

    getInstalled(name) {
      return installed.get(name) ?? null;
    },

    async setProvisionStatus(name, status, error) {
      const existing = requireInstalled(name);
      state.items[name] = {
        ...state.items[name],
        provisionStatus: status,
        provisionError: error,
      };
      existing.provisionStatus = status;
      existing.provisionError = error;
      await writeState(statePath, state);
      await rebuild();
    },
  };
}
