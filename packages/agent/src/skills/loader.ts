import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMdFile } from "../shared/parser.js";
import { compileSkill, createSkillSource } from "./compiler.js";
import type { CompiledSkill, InstallerError } from "./types.js";

export interface LoadedSkillsResult {
  skills: CompiledSkill[];
  failed: InstallerError[];
}

export async function loadSkillsFromDirectory(dirPath: string): Promise<LoadedSkillsResult> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(dirPath, entry.name))
      .sort((left, right) => left.localeCompare(right));

    const skills: CompiledSkill[] = [];
    const failed: InstallerError[] = [];

    for (const filePath of files) {
      try {
        const parsed = await parseMdFile(filePath);
        const source = createSkillSource(parsed);
        skills.push(compileSkill(source));
      } catch (error) {
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
