/**
 * Prompt asset loader — reads `.md` prompt files from disk.
 *
 * Resolves startup-time template variables (e.g. `{{DOWNLOADS_DIR}}`).
 * Runtime variables (e.g. `{{EXISTING_KEYS}}`) pass through untouched
 * and are resolved by the consuming lane code.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptAssets } from "./types.js";
import { renderTemplate } from "./assembler.js";

export function resolveBundledPromptsDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "..", "..", "prompts");
}

export interface LoadPromptAssetsOptions {
  promptsDir?: string;
  vars?: Record<string, string>;
}

/**
 * Load prompt assets from a directory.
 *
 * @param options.promptsDir - Absolute path to the prompts directory. Defaults to
 * the bundled `packages/agent/prompts` directory.
 * @param options.vars - Startup-time template variables to resolve immediately.
 * Must be provided by the caller (server bootstrap); the loader does not read env vars.
 */
export function loadPromptAssets(options: LoadPromptAssetsOptions = {}): PromptAssets {
  const promptsDir = options.promptsDir ?? resolveBundledPromptsDir();
  const cache = new Map<string, string>();
  const startupVars = options.vars ?? {};

  return {
    get(key: string): string {
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const filePath = resolve(promptsDir, `${key}.md`);
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8").trim();
      } catch (err) {
        throw new Error(`Prompt asset "${key}" not found at ${filePath}: ${(err as Error).message}`);
      }

      content = renderTemplate(content, startupVars);
      cache.set(key, content);
      return content;
    },
  };
}
