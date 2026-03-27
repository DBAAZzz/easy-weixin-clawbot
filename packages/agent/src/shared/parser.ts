import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9_-]{1,48}$/;

export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
  filePath: string;
  raw: string;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function asRecord(value: unknown, filePath: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Frontmatter must be an object: ${filePath}`);
  }

  return value as Record<string, unknown>;
}

export function validateCapabilityName(name: unknown, filePath: string): asserts name is string {
  if (typeof name !== "string" || !CAPABILITY_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid capability name in ${filePath}. Expected /^[a-z][a-z0-9_-]{1,48}$/`,
    );
  }
}

export function parseMdContent(rawContent: string, filePath: string): ParsedFile {
  const raw = normalizeNewlines(rawContent);
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    throw new Error(`Missing YAML frontmatter: ${filePath}`);
  }

  const frontmatter = asRecord(parse(match[1]) ?? {}, filePath);
  validateCapabilityName(frontmatter.name, filePath);

  return {
    frontmatter,
    body: match[2].trim(),
    filePath,
    raw: rawContent,
  };
}

export async function parseMdFile(filePath: string): Promise<ParsedFile> {
  const raw = await readFile(filePath, "utf8");
  return parseMdContent(raw, filePath);
}
