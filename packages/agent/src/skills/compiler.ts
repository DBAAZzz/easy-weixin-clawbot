import type { ParsedFile } from "../shared/parser.js";
import { normalizeFrontmatter } from "./normalizer.js";
import type { CompiledSkill, SkillActivation, SkillSource } from "./types.js";

function requireString(value: unknown, field: string, filePath: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected "${field}" to be a non-empty string in ${filePath}`);
  }
  return value.trim();
}

export function createSkillSource(parsed: ParsedFile): SkillSource {
  const { frontmatter, filePath, body } = parsed;
  const { normalized } = normalizeFrontmatter(frontmatter, { defaultType: "skill" });
  const activation =
    normalized.activation === undefined
      ? "on-demand"
      : requireString(normalized.activation, "activation", filePath);

  if (activation !== "always" && activation !== "on-demand") {
    throw new Error(`Unsupported activation "${activation}" in ${filePath}`);
  }

  if (normalized.type !== "skill") {
    throw new Error(`Expected type "skill" in ${filePath}`);
  }

  return {
    name: requireString(normalized.name, "name", filePath),
    version: requireString(normalized.version, "version", filePath),
    type: "skill",
    author: typeof normalized.author === "string" ? normalized.author.trim() : undefined,
    summary: requireString(normalized.summary, "summary", filePath),
    activation: activation as SkillActivation,
    body,
    filePath,
  };
}

export function compileSkill(source: SkillSource): CompiledSkill {
  return { source };
}
