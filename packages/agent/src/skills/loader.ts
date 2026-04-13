import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMdFile } from "../shared/parser.js";
import { compileSkill, createSkillSource } from "./compiler.js";
import type { CompiledSkill, InstallerError } from "./types.js";

export interface LoadedSkillsResult {
  skills: CompiledSkill[];
  failed: InstallerError[];
}

/**
 * Scan a directory for skill subdirectories, each containing a `SKILL.md`.
 * Directory layout: `{dirPath}/{skillName}/SKILL.md`
 */
export async function loadSkillsFromDirectory(dirPath: string): Promise<LoadedSkillsResult> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dirPath, entry.name, "SKILL.md"))
      .sort((left, right) => left.localeCompare(right));

    const skills: CompiledSkill[] = [];
    const failed: InstallerError[] = [];

    for (const filePath of dirs) {
      try {
        const parsed = await parseMdFile(filePath);
        const source = createSkillSource(parsed);
        skills.push(compileSkill(source));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        failed.push({
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { skills, failed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { skills: [], failed: [] };
    }
    throw error;
  }
}
