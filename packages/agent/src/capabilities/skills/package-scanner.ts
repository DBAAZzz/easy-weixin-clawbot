import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { isFile } from "./fs-utils.js";
import type { SkillPackageIndex } from "./types.js";

function toPosixPath(path: string): string {
  return path.split("\\").join("/");
}

async function collectFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(dirPath);
  return files;
}

const SCRIPT_EXTENSIONS = new Set([".py", ".js", ".mjs", ".cjs"]);

function isScriptFile(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return false;
  return SCRIPT_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase());
}

export async function scanSkillPackage(rootDir: string): Promise<SkillPackageIndex> {
  const skillMdPath = join(rootDir, "SKILL.md");
  const metaJsonPath = (await isFile(join(rootDir, "_meta.json"))) ? join(rootDir, "_meta.json") : undefined;
  const referencesDir = join(rootDir, "references");
  const scriptsDir = join(rootDir, "scripts");

  const referenceFiles = (await stat(referencesDir).then((info) => info.isDirectory()).catch(() => false))
    ? (await collectFiles(referencesDir)).map((filePath) => toPosixPath(relative(rootDir, filePath)))
    : [];

  const scriptFiles = (await stat(scriptsDir).then((info) => info.isDirectory()).catch(() => false))
    ? (await collectFiles(scriptsDir)).map((filePath) => toPosixPath(relative(rootDir, filePath)))
    : [];

  // Compat layer: scan root-level script files
  const rootScriptFiles: string[] = [];
  try {
    const rootEntries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isFile() && isScriptFile(entry.name)) {
        rootScriptFiles.push(entry.name);
      }
    }
  } catch {
    // Ignore read errors
  }

  const requirementsTxtPath = (await isFile(join(rootDir, "requirements.txt")))
    ? join(rootDir, "requirements.txt")
    : undefined;

  return {
    rootDir,
    skillMdPath,
    metaJsonPath,
    referenceFiles: referenceFiles.sort((left, right) => left.localeCompare(right)),
    scriptFiles: scriptFiles.sort((left, right) => left.localeCompare(right)),
    rootScriptFiles: rootScriptFiles.sort((left, right) => left.localeCompare(right)),
    requirementsTxtPath,
  };
}
