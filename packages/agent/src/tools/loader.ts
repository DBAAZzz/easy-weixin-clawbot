import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMdFile } from "../shared/parser.js";
import { compileTool, createToolSource } from "./compiler.js";
import type { CompiledTool, InstallerError } from "./types.js";

export interface LoadedToolsResult {
  tools: CompiledTool[];
  failed: InstallerError[];
}

export async function loadToolsFromDirectory(dirPath: string): Promise<LoadedToolsResult> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(dirPath, entry.name))
      .sort((left, right) => left.localeCompare(right));

    const tools: CompiledTool[] = [];
    const failed: InstallerError[] = [];

    for (const filePath of files) {
      try {
        const parsed = await parseMdFile(filePath);
        const source = createToolSource(parsed);
        tools.push(compileTool(source));
      } catch (error) {
        failed.push({
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { tools, failed };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { tools: [], failed: [] };
    }
    throw error;
  }
}
