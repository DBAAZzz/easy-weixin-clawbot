import { z, type ZodTypeAny } from "zod";
import type { ParsedFile } from "../shared/parser.js";
import type { CompiledTool, ParameterDef, ToolSource } from "./types.js";
import { getNativeHandler } from "./handlers/index.js";

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

function toParameterDef(
  name: string,
  value: unknown,
  filePath: string,
): ParameterDef {
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

function buildParameterSchema(definition: ParameterDef): ZodTypeAny {
  if (definition.enum && definition.enum.length > 0) {
    const values = definition.enum as [string, ...string[]];
    let schema: ZodTypeAny = z.enum(values as [string, ...string[]]);
    if (definition.description) {
      schema = schema.describe(definition.description);
    }
    return schema;
  }

  let schema: ZodTypeAny;
  switch (definition.type) {
    case "string":
      schema = z.string();
      break;
    case "integer":
      schema = z.number().int();
      break;
    case "number":
      schema = z.number();
      break;
    case "boolean":
      schema = z.boolean();
      break;
  }

  if (definition.description) {
    schema = schema.describe(definition.description);
  }
  if (definition.default !== undefined) {
    schema = schema.default(definition.default as any);
  }

  return schema;
}

function buildToolParameters(inputSchema: Record<string, ParameterDef>): ZodTypeAny {
  const shape: Record<string, ZodTypeAny> = {};

  for (const [name, definition] of Object.entries(inputSchema)) {
    const propertySchema = buildParameterSchema(definition);
    shape[name] = definition.required ? propertySchema : propertySchema.optional();
  }

  return z.object(shape);
}

export function createToolSource(parsed: ParsedFile): ToolSource {
  const { frontmatter, filePath, body } = parsed;
  const inputSchemaRecord = asObject(frontmatter.inputSchema ?? {}, "inputSchema", filePath);
  const inputSchema = Object.fromEntries(
    Object.entries(inputSchemaRecord).map(([name, value]) => [name, toParameterDef(name, value, filePath)]),
  );

  return {
    name: requireString(frontmatter.name, "name", filePath),
    version: requireString(frontmatter.version, "version", filePath),
    type: frontmatter.type === "tool" ? "tool" : (() => { throw new Error(`Expected type "tool" in ${filePath}`); })(),
    author: typeof frontmatter.author === "string" ? frontmatter.author.trim() : undefined,
    summary: requireString(frontmatter.summary, "summary", filePath),
    handler: requireString(frontmatter.handler, "handler", filePath),
    handlerConfig:
      frontmatter.handlerConfig && typeof frontmatter.handlerConfig === "object" && !Array.isArray(frontmatter.handlerConfig)
        ? (frontmatter.handlerConfig as Record<string, unknown>)
        : undefined,
    inputSchema,
    body,
    filePath,
  };
}

export function compileTool(source: ToolSource): CompiledTool {
  const handler = getNativeHandler(source.handler);
  if (!handler) {
    throw new Error(`Unknown tool handler "${source.handler}" in ${source.filePath}`);
  }

  return {
    source,
    parameters: buildToolParameters(source.inputSchema),
    execute(args, ctx) {
      return handler.execute(args, source.handlerConfig ?? {}, ctx);
    },
  };
}
