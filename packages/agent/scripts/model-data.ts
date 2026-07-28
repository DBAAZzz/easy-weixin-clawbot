/**
 * Integrity rules for the generated model catalog, shared by the generator and
 * the `--check` entry point.
 *
 * Stale model metadata degrades silently: a context window set too small makes
 * the trimmer discard history nobody asked it to discard, one set too large
 * turns into a provider 400 only once a conversation grows long enough. Neither
 * surfaces as a test failure, so the catalog carries a manifest and CI asserts
 * it still matches.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedModelMeta } from "../src/llm/model-catalog-types.js";

export const MODEL_DATA_SCHEMA_VERSION = 1;
export const MODEL_DATA_MANIFEST_FILE = ".manifest.json";

export type { GeneratedModelMeta };
export type ProviderModels = Record<string, GeneratedModelMeta>;

export interface ModelDataManifest {
  schemaVersion: number;
  generatedAt: string;
  /** Hash of provider → model-id structure, independent of metadata values. */
  structureHash: string;
  /** Per-file content hashes, so a hand-edited data file is detectable. */
  files: Record<string, string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  return Object.fromEntries(Array.from(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function serializeProviderModels(models: ProviderModels): string {
  return `${JSON.stringify(sortedRecord(Object.entries(models)), null, 2)}\n`;
}

export function modelDataStructureHash(structure: Record<string, readonly string[]>): string {
  const normalized = sortedRecord(
    Object.entries(structure).map(([provider, ids]) => [provider, [...ids].sort()] as const),
  );
  return sha256(JSON.stringify(normalized));
}

export function createModelDataManifest(
  structure: Record<string, readonly string[]>,
  fileContents: Readonly<Record<string, string>>,
  generatedAt: string,
): ModelDataManifest {
  return {
    schemaVersion: MODEL_DATA_SCHEMA_VERSION,
    generatedAt,
    structureHash: modelDataStructureHash(structure),
    files: sortedRecord(Object.entries(fileContents).map(([f, c]) => [f, sha256(c)] as const)),
  };
}

function validateModelMeta(value: unknown, label: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return;
  }

  for (const field of ["contextWindow", "maxOutputTokens"] as const) {
    const n = value[field];
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      errors.push(`${label} has invalid ${field}: ${JSON.stringify(n)}`);
    }
  }

  // A window smaller than the reserve leaves a negative budget, which reads as
  // "trim everything" — the trimmer would drop the whole conversation.
  const context = value.contextWindow;
  const output = value.maxOutputTokens;
  if (typeof context === "number" && typeof output === "number" && output >= context) {
    errors.push(`${label} has maxOutputTokens (${output}) >= contextWindow (${context})`);
  }

  if (typeof value.supportsImageInput !== "boolean") {
    errors.push(`${label} has no supportsImageInput boolean`);
  }
  if (value.requiresReasonedToolHistory !== undefined && value.requiresReasonedToolHistory !== true) {
    errors.push(`${label} must omit requiresReasonedToolHistory rather than set it false`);
  }
}

/**
 * Verify the data directory against `structure`: same providers, same model ids,
 * well-formed values, and content hashes matching the manifest.
 */
export function validateModelDataDirectory(
  structure: Record<string, readonly string[]>,
  dataDir: string,
): void {
  if (!existsSync(dataDir) || !statSync(dataDir).isDirectory()) {
    throw new Error(`Generated model data directory does not exist: ${dataDir}`);
  }

  const errors: string[] = [];
  const expectedFiles = Object.keys(structure).map((p) => `${p}.json`).sort();
  const actualFiles = readdirSync(dataDir)
    .filter((entry) => entry.endsWith(".json") && entry !== MODEL_DATA_MANIFEST_FILE)
    .sort();

  const missing = expectedFiles.filter((f) => !actualFiles.includes(f));
  const extra = actualFiles.filter((f) => !expectedFiles.includes(f));
  if (missing.length > 0) errors.push(`missing data files: ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`unexpected data files: ${extra.join(", ")}`);

  let manifest: ModelDataManifest | undefined;
  const manifestPath = join(dataDir, MODEL_DATA_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    errors.push(`manifest is missing: ${MODEL_DATA_MANIFEST_FILE}`);
  } else {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ModelDataManifest;
    } catch (error) {
      errors.push(`manifest is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (manifest) {
    if (manifest.schemaVersion !== MODEL_DATA_SCHEMA_VERSION) {
      errors.push(
        `manifest schemaVersion is ${manifest.schemaVersion}, expected ${MODEL_DATA_SCHEMA_VERSION}`,
      );
    }
    if (typeof manifest.generatedAt !== "string" || Number.isNaN(Date.parse(manifest.generatedAt))) {
      errors.push("manifest has an invalid generatedAt timestamp");
    }
    if (manifest.structureHash !== modelDataStructureHash(structure)) {
      errors.push("manifest structureHash does not match the provider/model listing");
    }
  }

  for (const [provider, expectedIds] of Object.entries(structure)) {
    const filename = `${provider}.json`;
    const path = join(dataDir, filename);
    if (!existsSync(path)) continue;

    const content = readFileSync(path, "utf8");
    if (manifest?.files && manifest.files[filename] !== sha256(content)) {
      errors.push(`${filename} does not match its manifest hash (hand-edited?)`);
    }

    let models: unknown;
    try {
      models = JSON.parse(content);
    } catch (error) {
      errors.push(`${filename} is not valid JSON: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    if (!isRecord(models)) {
      errors.push(`${filename} must contain a JSON object`);
      continue;
    }

    const actualIds = Object.keys(models).sort();
    const expected = [...expectedIds].sort();
    if (actualIds.length !== expected.length || actualIds.some((id, i) => id !== expected[i])) {
      errors.push(`${filename} model ids do not match the generated listing`);
    }
    for (const [modelId, meta] of Object.entries(models)) {
      validateModelMeta(meta, `${provider}/${modelId}`, errors);
    }
  }

  if (errors.length > 0) {
    const visible = errors.slice(0, 30);
    const suffix = errors.length > visible.length ? `\n  ... and ${errors.length - visible.length} more` : "";
    throw new Error(`Invalid generated model data:\n${visible.map((e) => `  - ${e}`).join("\n")}${suffix}`);
  }
}

/** Read the structure implied by the data directory itself, for the check path. */
export function readModelDataStructure(dataDir: string): Record<string, string[]> {
  const files = readdirSync(dataDir).filter(
    (entry) => entry.endsWith(".json") && entry !== MODEL_DATA_MANIFEST_FILE,
  );
  return sortedRecord(
    files.map((file) => {
      const provider = file.slice(0, -".json".length);
      const models = JSON.parse(readFileSync(join(dataDir, file), "utf8")) as ProviderModels;
      return [provider, Object.keys(models).sort()] as const;
    }),
  );
}
