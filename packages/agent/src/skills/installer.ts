import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseMdContent } from "../shared/parser.js";
import { compileSkill, createSkillSource } from "./compiler.js";
import { loadSkillsFromDirectory } from "./loader.js";
import type {
  InstalledSkill,
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

function toCatalogItem(installed: InstalledSkill): SkillCatalogItem {
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

  async function rebuild(): Promise<SkillInstallerResult> {
    const builtin = await loadSkillsFromDirectory(builtinDir);
    const user = await loadSkillsFromDirectory(userDir);
    const next = new Map<string, InstalledSkill>();
    const now = new Date().toISOString();

    for (const compiled of builtin.skills) {
      const itemState = state.items[compiled.source.name] ?? {};
      state.items[compiled.source.name] = {
        enabled: itemState.enabled ?? true,
        installedAt: itemState.installedAt ?? now,
      };
      next.set(compiled.source.name, {
        skill: compiled,
        origin: "builtin",
        enabled: state.items[compiled.source.name].enabled ?? true,
        installedAt: state.items[compiled.source.name].installedAt ?? now,
      });
    }

    for (const compiled of user.skills) {
      const itemState = state.items[compiled.source.name] ?? {};
      state.items[compiled.source.name] = {
        enabled: itemState.enabled ?? true,
        installedAt: itemState.installedAt ?? now,
      };
      next.set(compiled.source.name, {
        skill: compiled,
        origin: "user",
        enabled: state.items[compiled.source.name].enabled ?? true,
        installedAt: state.items[compiled.source.name].installedAt ?? now,
      });
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
    const compiled = await parseInline(markdown, join(userDir, "inline-skill.md"));
    if (expectedName && compiled.source.name !== expectedName) {
      throw new Error(`Skill name mismatch: expected "${expectedName}" but got "${compiled.source.name}"`);
    }

    const filePath = join(userDir, `${compiled.source.name}.md`);
    await writeFile(filePath, markdown, "utf8");

    const previousState = state.items[compiled.source.name];
    state.items[compiled.source.name] = {
      enabled: previousState?.enabled ?? true,
      installedAt: previousState?.installedAt ?? new Date().toISOString(),
    };

    await rebuild();
    return requireCatalogItem(compiled.source.name);
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
      };
    },

    install(markdown) {
      return writeUserSkill(markdown);
    },

    update(name, markdown) {
      return writeUserSkill(markdown, name);
    },

    async remove(name) {
      const existing = requireInstalled(name);
      if (existing.origin !== "user") {
        throw new Error(`Builtin skill cannot be removed: ${name}`);
      }

      const filePath = join(userDir, `${name}.md`);
      if (await fileExists(filePath)) {
        await rm(filePath);
      }

      await rebuild();
    },

    async enable(name) {
      const existing = requireInstalled(name);
      state.items[name] = {
        enabled: true,
        installedAt: existing.installedAt,
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
      };
      await writeState(statePath, state);
      await rebuild();
      return requireCatalogItem(name);
    },
  };
}
