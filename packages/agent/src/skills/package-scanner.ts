import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { SkillPackageIndex } from "./types.js";

function toPosixPath(path: string): string {
  return path.split("\\").join("/");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
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

export async function scanSkillPackage(rootDir: string): Promise<SkillPackageIndex> {
  const skillMdPath = join(rootDir, "SKILL.md");
  const metaJsonPath = (await fileExists(join(rootDir, "_meta.json"))) ? join(rootDir, "_meta.json") : undefined;
  const referencesDir = join(rootDir, "references");
  const scriptsDir = join(rootDir, "scripts");

  const referenceFiles = (await stat(referencesDir).then((info) => info.isDirectory()).catch(() => false))
    ? (await collectFiles(referencesDir)).map((filePath) => toPosixPath(relative(rootDir, filePath)))
    : [];

  const scriptFiles = (await stat(scriptsDir).then((info) => info.isDirectory()).catch(() => false))
    ? (await collectFiles(scriptsDir)).map((filePath) => toPosixPath(relative(rootDir, filePath)))
    : [];

  return {
    rootDir,
    skillMdPath,
    metaJsonPath,
    referenceFiles: referenceFiles.sort((left, right) => left.localeCompare(right)),
    scriptFiles: scriptFiles.sort((left, right) => left.localeCompare(right)),
  };
}
