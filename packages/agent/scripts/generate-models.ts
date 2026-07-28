#!/usr/bin/env node
/**
 * Regenerate the model metadata catalog from models.dev.
 *
 *   pnpm -F @clawbot/agent generate:models
 *
 * Model metadata used to be a per-provider guess, which is a category error:
 * within one provider the window can span 8k (Xiaomi's TTS models) to 1M
 * (mimo-v2.5), so a provider average is wrong for nearly every model it covers.
 * This pulls the real per-model numbers instead.
 *
 * models.dev is a build-time dependency only — the catalog is committed, and
 * nothing fetches at runtime.
 */

import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createModelDataManifest,
  MODEL_DATA_MANIFEST_FILE,
  serializeProviderModels,
  validateModelDataDirectory,
  type GeneratedModelMeta,
  type ProviderModels,
} from "./model-data.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(packageRoot, "src/llm/data");
const catalogPath = join(packageRoot, "src/llm/models.generated.ts");

const MODELS_DEV_URL = "https://models.dev/api.json";

// ── Upstream shape ───────────────────────────────────────────────────

interface ModelsDevModel {
  tool_call?: boolean;
  reasoning?: boolean;
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
}

type ModelsDevCatalog = Record<string, { models?: Record<string, ModelsDevModel> } | undefined>;

// ── Provider mapping ─────────────────────────────────────────────────

/**
 * Our provider id → the models.dev catalog it draws from.
 *
 * Several of ours are compatibility endpoints in front of someone else's
 * models, so the mapping is many-to-one: `kimi` and `moonshot` are the same
 * upstream catalog behind the same base URL, and `xiaomi-anthropic` serves the
 * `xiaomi` models over an Anthropic-shaped API. Keep this in sync with
 * PROVIDER_BUILDERS in src/llm/provider-factory.ts.
 */
const PROVIDER_SOURCES: Record<string, string> = {
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  deepseek: "deepseek",
  moonshot: "moonshotai-cn",
  kimi: "moonshotai-cn",
  "kimi-coding": "kimi-for-coding",
  xiaomi: "xiaomi-token-plan-cn",
  "xiaomi-anthropic": "xiaomi-token-plan-cn",
  openrouter: "openrouter",
  xai: "xai",
  groq: "groq",
  mistral: "mistral",
};

/**
 * Provider-level API quirks, resolved to per-model values at generation time.
 *
 * These are properties of the endpoint rather than of the model, but they only
 * apply to some of a provider's models, so they cannot live in the runtime as a
 * provider lookup without over-applying. Deriving them here keeps the runtime a
 * pure per-model table.
 *
 * DeepSeek: thinking mode rejects historical assistant tool calls that carry no
 * reasoning_content. `deepseek-chat` is not a thinking model and must not be
 * flagged — doing so would narrate its tool history for no reason.
 */
const PROVIDER_QUIRKS: Record<string, (model: ModelsDevModel) => Partial<GeneratedModelMeta>> = {
  deepseek: (model) => (model.reasoning === true ? { requiresReasonedToolHistory: true } : {}),
};

// ── Mapping ──────────────────────────────────────────────────────────

/**
 * Ceiling on the output reserve.
 *
 * `maxOutputTokens` is not sent to the provider — its only consumer is the
 * context budget, where it is subtracted from the window to leave room for the
 * reply (see engine/conversation/context-window.ts). Reserving more than a turn
 * can plausibly emit just shrinks the history for nothing, and this agent writes
 * chat replies, not documents.
 */
const MAX_OUTPUT_RESERVE = 32_768;

/**
 * Derive the output reserve from the upstream cap.
 *
 * Many providers report `output === context`, meaning output is not separately
 * capped rather than that a reply may consume the entire window. Storing that
 * verbatim would drive the budget to zero or below and make the trimmer discard
 * the whole conversation, so the reserve is bounded three ways: never more than
 * the model can emit, never more than a turn needs, and never more than half the
 * window.
 */
function toOutputReserve(contextWindow: number, upstreamOutput: number): number {
  return Math.min(upstreamOutput, MAX_OUTPUT_RESERVE, Math.floor(contextWindow / 2));
}

function toGeneratedMeta(
  providerId: string,
  model: ModelsDevModel,
): GeneratedModelMeta | undefined {
  const contextWindow = model.limit?.context;
  const upstreamOutput = model.limit?.output;

  // A model with no declared limits gives us nothing the fallback does not
  // already provide, and emitting a guess here would look authoritative.
  if (!contextWindow || !upstreamOutput) return undefined;

  return {
    contextWindow,
    maxOutputTokens: toOutputReserve(contextWindow, upstreamOutput),
    supportsImageInput: model.modalities?.input?.includes("image") === true,
    ...PROVIDER_QUIRKS[providerId]?.(model),
  };
}

function buildCatalog(upstream: ModelsDevCatalog): {
  providers: Record<string, ProviderModels>;
  skipped: Record<string, number>;
} {
  const providers: Record<string, ProviderModels> = {};
  const skipped: Record<string, number> = {};

  for (const [providerId, sourceId] of Object.entries(PROVIDER_SOURCES)) {
    const source = upstream[sourceId];
    if (!source?.models) {
      throw new Error(
        `models.dev has no catalog for ${JSON.stringify(sourceId)} (mapped from ${providerId}). ` +
          `Upstream may have renamed it — update PROVIDER_SOURCES.`,
      );
    }

    const models: ProviderModels = {};
    let dropped = 0;

    for (const [modelId, model] of Object.entries(source.models)) {
      // The agent drives every turn through tool calls; a model without them
      // cannot run a conversation here regardless of its window.
      if (model.tool_call !== true) continue;

      const meta = toGeneratedMeta(providerId, model);
      if (!meta) {
        dropped++;
        continue;
      }
      models[modelId] = meta;
    }

    if (Object.keys(models).length === 0) {
      throw new Error(`No usable models resolved for ${providerId} (source ${sourceId})`);
    }

    providers[providerId] = models;
    if (dropped > 0) skipped[providerId] = dropped;
  }

  return { providers, skipped };
}

// ── Emit ─────────────────────────────────────────────────────────────

const GENERATED_HEADER = `// This file is auto-generated by scripts/generate-models.ts
// Do not edit manually — run 'pnpm -F @clawbot/agent generate:models' to update.
// Hand corrections belong in src/llm/model-overrides.ts.

`;

/** `kimi-coding` → `KIMI_CODING_MODELS`, usable as an identifier. */
function catalogConstName(providerId: string): string {
  return `${providerId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_MODELS`;
}

function renderCatalogModule(providerIds: readonly string[]): string {
  let out = GENERATED_HEADER;
  out += `import type { GeneratedModelCatalog } from "./model-catalog-types.js";\n\n`;
  for (const providerId of providerIds) {
    out += `import ${catalogConstName(providerId)} from "./data/${providerId}.json" with { type: "json" };\n`;
  }
  out += `\nexport const GENERATED_MODEL_CATALOG: GeneratedModelCatalog = {\n`;
  for (const providerId of providerIds) {
    out += `  ${JSON.stringify(providerId)}: ${catalogConstName(providerId)},\n`;
  }
  out += `};\n`;
  return out;
}

/**
 * Write data + catalog module, staging first so a failure mid-write cannot leave
 * a half-updated catalog behind: the previous data directory is only replaced
 * once the new one validates.
 */
function writeCatalog(providers: Record<string, ProviderModels>): void {
  const providerIds = Object.keys(providers).sort();
  const structure = Object.fromEntries(
    providerIds.map((id) => [id, Object.keys(providers[id]).sort()] as const),
  );

  const stagingRoot = mkdtempSync(join(packageRoot, "src/llm", ".model-generation-"));
  const stagedDataDir = join(stagingRoot, "data");
  const previousDataDir = join(stagingRoot, "previous-data");

  try {
    mkdirSync(stagedDataDir, { recursive: true });

    const fileContents: Record<string, string> = {};
    for (const providerId of providerIds) {
      const filename = `${providerId}.json`;
      const content = serializeProviderModels(providers[providerId]);
      fileContents[filename] = content;
      writeFileSync(join(stagedDataDir, filename), content);
    }
    writeFileSync(
      join(stagedDataDir, MODEL_DATA_MANIFEST_FILE),
      `${JSON.stringify(createModelDataManifest(structure, fileContents, new Date().toISOString()), null, 2)}\n`,
    );

    validateModelDataDirectory(structure, stagedDataDir);

    let hadPreviousData = false;
    try {
      renameSync(dataDir, previousDataDir);
      hadPreviousData = true;
    } catch {
      // First run — nothing to preserve.
    }

    try {
      renameSync(stagedDataDir, dataDir);
      validateModelDataDirectory(structure, dataDir);
    } catch (error) {
      rmSync(dataDir, { recursive: true, force: true });
      if (hadPreviousData) renameSync(previousDataDir, dataDir);
      throw error;
    }

    writeFileSync(catalogPath, renderCatalogModule(providerIds));
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Fetching ${MODELS_DEV_URL} ...`);
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
  const upstream = (await response.json()) as ModelsDevCatalog;

  const { providers, skipped } = buildCatalog(upstream);
  writeCatalog(providers);

  const total = Object.values(providers).reduce((sum, m) => sum + Object.keys(m).length, 0);
  console.log(`\nGenerated ${total} models across ${Object.keys(providers).length} providers:`);
  for (const providerId of Object.keys(providers).sort()) {
    const dropped = skipped[providerId];
    console.log(
      `  ${providerId.padEnd(18)} ${String(Object.keys(providers[providerId]).length).padStart(4)}` +
        (dropped ? `  (${dropped} skipped: no usable limits)` : ""),
    );
  }
  console.log(`\nStale data is invisible at runtime — commit the result and let CI check it.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

// Cleanup for interrupted runs: staging dirs are siblings of src/llm.
process.on("SIGINT", () => {
  for (const entry of readdirSync(join(packageRoot, "src/llm"))) {
    if (entry.startsWith(".model-generation-")) {
      rmSync(join(packageRoot, "src/llm", entry), { recursive: true, force: true });
    }
  }
  process.exit(130);
});
