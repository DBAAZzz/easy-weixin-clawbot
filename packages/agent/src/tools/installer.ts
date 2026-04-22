import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseMdContent } from "../shared/parser.js";
import { compileTool, createToolSource } from "./compiler.js";
import { loadToolsFromDirectory } from "./loader.js";
import type {
  InstalledTool,
  ToolCatalogItem,
  ToolInstaller,
  ToolInstallerResult,
  ToolRegistry,
  ToolSnapshot,
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

const EMPTY_STATE: InstallerState = { items: {} };
const SYSTEM_TOOL_NAMES = new Set(["web_fetch", "web_search"]);

function isSystemManagedTool(name: string): boolean {
  return SYSTEM_TOOL_NAMES.has(name);
}

function resolveToolEnabled(name: string, enabled: boolean | undefined): boolean {
  return isSystemManagedTool(name) ? true : enabled ?? true;
}

function assertUserToolNameAllowed(name: string): void {
  if (isSystemManagedTool(name)) {
    throw new Error(`Tool name is reserved for system builtin: ${name}`);
  }
}

function getStatePath(userDir: string): string {
  return join(dirname(userDir), "state.json");
}

async function readState(statePath: string): Promise<InstallerState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as InstallerState;
    return parsed && typeof parsed === "object" && parsed.items ? parsed : EMPTY_STATE;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { items: {} };
    }
    throw error;
  }
}

async function writeState(statePath: string, state: InstallerState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

function toCatalogItem(installed: InstalledTool): ToolCatalogItem {
  return {
    name: installed.tool.source.name,
    summary: installed.tool.source.summary,
    version: installed.tool.source.version,
    author: installed.tool.source.author,
    type: "tool",
    handler: installed.tool.source.handler,
    origin: installed.origin,
    enabled: installed.enabled,
    managedBySystem: installed.managedBySystem,
    parameterNames: Object.keys(installed.tool.source.inputSchema).sort(),
    installedAt: installed.installedAt,
    filePath: installed.tool.source.filePath,
  };
}

function buildSnapshot(installed: InstalledTool[]): ToolSnapshot {
  return {
    tools: installed
      .filter((item) => item.enabled)
      .sort((left, right) => left.tool.source.name.localeCompare(right.tool.source.name))
      .map((item) => ({
        name: item.tool.source.name,
        description: item.tool.source.body,
        parameters: item.tool.parameters,
        execute: item.tool.execute,
      })),
  };
}

export function createToolInstaller(registry: ToolRegistry): ToolInstaller {
  let builtinDir = "";
  let userDir = "";
  let statePath = "";
  let state: InstallerState = { items: {} };
  let installed = new Map<string, InstalledTool>();

  async function rebuild(): Promise<ToolInstallerResult> {
    const builtin = await loadToolsFromDirectory(builtinDir);
    const user = await loadToolsFromDirectory(userDir);
    const next = new Map<string, InstalledTool>();
    const now = new Date().toISOString();
    const failed = [...builtin.failed, ...user.failed];

    for (const compiled of builtin.tools) {
      const itemState = state.items[compiled.source.name] ?? {};
      state.items[compiled.source.name] = {
        enabled: resolveToolEnabled(compiled.source.name, itemState.enabled),
        installedAt: itemState.installedAt ?? now,
      };
      next.set(compiled.source.name, {
        tool: compiled,
        origin: "builtin",
        enabled: resolveToolEnabled(compiled.source.name, state.items[compiled.source.name].enabled),
        managedBySystem: isSystemManagedTool(compiled.source.name),
        installedAt: state.items[compiled.source.name].installedAt ?? now,
      });
    }

    for (const compiled of user.tools) {
      if (isSystemManagedTool(compiled.source.name)) {
        failed.push({
          filePath: compiled.source.filePath,
          error: `User tool cannot override system builtin: ${compiled.source.name}`,
        });
        continue;
      }

      const itemState = state.items[compiled.source.name] ?? {};
      state.items[compiled.source.name] = {
        enabled: resolveToolEnabled(compiled.source.name, itemState.enabled),
        installedAt: itemState.installedAt ?? now,
      };
      next.set(compiled.source.name, {
        tool: compiled,
        origin: "user",
        enabled: resolveToolEnabled(compiled.source.name, state.items[compiled.source.name].enabled),
        managedBySystem: false,
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
      failed,
    };
  }

  function requireInstalled(name: string): InstalledTool {
    const item = installed.get(name);
    if (!item) {
      throw new Error(`Tool not found: ${name}`);
    }
    return item;
  }

  async function parseInline(markdown: string, filePath: string) {
    const parsed = parseMdContent(markdown, filePath);
    return compileTool(createToolSource(parsed));
  }

  async function writeUserTool(markdown: string, expectedName?: string): Promise<ToolCatalogItem> {
    await ensureDir(userDir);
    const compiled = await parseInline(markdown, join(userDir, "inline-tool.md"));
    assertUserToolNameAllowed(compiled.source.name);
    if (expectedName && compiled.source.name !== expectedName) {
      throw new Error(`Tool name mismatch: expected "${expectedName}" but got "${compiled.source.name}"`);
    }

    const filePath = join(userDir, `${compiled.source.name}.md`);
    await writeFile(filePath, markdown, "utf8");

    const previousState = state.items[compiled.source.name];
    state.items[compiled.source.name] = {
      enabled: resolveToolEnabled(compiled.source.name, previousState?.enabled),
      installedAt: previousState?.installedAt ?? new Date().toISOString(),
    };

    await rebuild();
    return requireCatalogItem(compiled.source.name);
  }

  function requireCatalogItem(name: string): ToolCatalogItem {
    return toCatalogItem(requireInstalled(name));
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
      return readFile(item.tool.source.filePath, "utf8");
    },

    async validate(markdown) {
      const compiled = await parseInline(markdown, "<inline-tool>");
      assertUserToolNameAllowed(compiled.source.name);
      return {
        name: compiled.source.name,
        summary: compiled.source.summary,
        version: compiled.source.version,
        author: compiled.source.author,
        type: "tool",
        handler: compiled.source.handler,
        origin: "user",
        enabled: true,
        managedBySystem: false,
        parameterNames: Object.keys(compiled.source.inputSchema).sort(),
        installedAt: new Date().toISOString(),
        filePath: compiled.source.filePath,
      };
    },

    install(markdown) {
      return writeUserTool(markdown);
    },

    update(name, markdown) {
      return writeUserTool(markdown, name);
    },

    async remove(name) {
      const existing = requireInstalled(name);
      if (existing.origin !== "user") {
        throw new Error(`Builtin tool cannot be removed: ${name}`);
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
        enabled: resolveToolEnabled(name, true),
        installedAt: existing.installedAt,
      };
      await writeState(statePath, state);
      await rebuild();
      return requireCatalogItem(name);
    },

    async disable(name) {
      if (isSystemManagedTool(name)) {
        throw new Error(`System tool cannot be disabled: ${name}`);
      }

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
