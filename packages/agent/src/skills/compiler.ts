import { dirname } from "node:path";
import type { ParsedFile } from "../shared/parser.js";
import { buildToolParametersFromDefs, compileToolFromParts } from "../tools/compiler.js";
import type { ParameterDef } from "../tools/types.js";
import { normalizeFrontmatter } from "./normalizer.js";
import type { CompiledSkill, SkillActivation, SkillRuntimeDecl, SkillSource } from "./types.js";

function requireString(value: unknown, field: string, filePath: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Expected "${field}" to be a non-empty string in ${filePath}`);
  }
  return value.trim();
}

function asObject(value: unknown, field: string, filePath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected "${field}" to be an object in ${filePath}`);
  }
  return value as Record<string, unknown>;
}

function toParameterDef(name: string, value: unknown, filePath: string): ParameterDef {
  const record = asObject(value, `inputSchema.${name}`, filePath);
  const type = record.type;
  const description = record.description;
  if (!["string", "integer", "number", "boolean"].includes(String(type))) {
    throw new Error(`Unsupported parameter type for "${name}" in ${filePath}`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error(`Parameter "${name}" requires a description in ${filePath}`);
  }
  return {
    type: type as ParameterDef["type"],
    description: description.trim(),
    required: record.required === true,
    default: record.default,
    enum: Array.isArray(record.enum) ? record.enum : undefined,
  };
}

function parseInputSchema(
  raw: unknown,
  filePath: string,
): Record<string, ParameterDef> | undefined {
  if (raw === undefined || raw === null) return undefined;
  const record = asObject(raw, "inputSchema", filePath);
  return Object.fromEntries(
    Object.entries(record).map(([name, value]) => [name, toParameterDef(name, value, filePath)]),
  );
}

function parseRuntime(raw: unknown, filePath: string): SkillRuntimeDecl | undefined {
  if (raw === undefined || raw === null) return undefined;
  const record = asObject(raw, "runtime", filePath);
  const type = record.type;
  if (type !== "python" && type !== "node") {
    throw new Error(`Unsupported runtime type "${type}" in ${filePath}`);
  }
  const deps = record.dependencies;
  if (!Array.isArray(deps) || deps.some((d) => typeof d !== "string")) {
    throw new Error(`runtime.dependencies must be an array of strings in ${filePath}`);
  }
  return { type, dependencies: deps as string[] };
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

  const handler =
    typeof normalized.handler === "string" && normalized.handler.trim()
      ? normalized.handler.trim()
      : undefined;

  const inputSchema = parseInputSchema(normalized.inputSchema, filePath);

  // Validate: handler and inputSchema must appear together
  if (handler && !inputSchema) {
    throw new Error(`Skill has "handler" but missing "inputSchema" in ${filePath}`);
  }
  if (!handler && inputSchema) {
    throw new Error(`Skill has "inputSchema" but missing "handler" in ${filePath}`);
  }

  const handlerConfig =
    normalized.handlerConfig &&
    typeof normalized.handlerConfig === "object" &&
    !Array.isArray(normalized.handlerConfig)
      ? (normalized.handlerConfig as Record<string, unknown>)
      : undefined;

  const runtime = parseRuntime(normalized.runtime, filePath);

  return {
    name: requireString(normalized.name, "name", filePath),
    version: requireString(normalized.version, "version", filePath),
    type: "skill",
    author: typeof normalized.author === "string" ? normalized.author.trim() : undefined,
    summary: requireString(normalized.summary, "summary", filePath),
    activation: activation as SkillActivation,
    body,
    filePath,
    handler,
    handlerConfig,
    inputSchema,
    runtime,
  };
}

export function compileSkill(source: SkillSource): CompiledSkill {
  if (!source.handler || !source.inputSchema) {
    return { source };
  }

  // Build companion tool: inject __skillDir into handlerConfig
  const skillDir = dirname(source.filePath);
  const effectiveConfig: Record<string, unknown> = {
    ...(source.handlerConfig ?? {}),
    __skillDir: skillDir,
  };

  const companionTool = compileToolFromParts({
    name: source.name,
    summary: source.summary,
    handler: source.handler,
    handlerConfig: effectiveConfig,
    inputSchema: source.inputSchema,
    body: source.body,
    filePath: source.filePath,
  });

  return { source, companionTool };
}
