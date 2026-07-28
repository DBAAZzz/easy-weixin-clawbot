/**
 * Per-model metadata lookup.
 *
 * Metadata used to be keyed by provider, which is the wrong unit: one provider's
 * models can span an 8k window and a 1M one, so a provider-wide number is a
 * guess that is wrong for most of what it covers — and wrong asymmetrically,
 * since guessing high turns into a provider 400 while guessing low silently
 * over-trims. Values now come from the generated catalog, per model.
 */

import { GENERATED_MODEL_CATALOG } from "./models.generated.js";
import { MODEL_META_OVERRIDES } from "./model-overrides.js";
import type { GeneratedModelMeta } from "./model-catalog-types.js";
import type { ModelMeta } from "./types.js";

/**
 * Used when a model is in no catalog at all — a custom relay base URL, a
 * self-hosted endpoint, or a model newer than the last catalog refresh.
 *
 * Deliberately one value for every provider. A per-provider fallback would just
 * be the old guess in a new place, and this one at least fails predictably: it
 * is small enough that a wrong guess over-trims rather than overflowing, and a
 * user who needs better can name the model in `model-overrides.ts`.
 */
export const FALLBACK_MODEL_META: ModelMeta = {
  contextWindow: 128_000,
  maxOutputTokens: 4096,
  supportsImageInput: false,
};

export function modelSupportsVision(meta: ModelMeta): boolean {
  return meta.supportsImageInput === true;
}

/**
 * Reduce a model id to the form the catalog is keyed by.
 *
 * Providers ship the same model under dated, aliased, and variant-suffixed ids
 * (`claude-sonnet-4-5-20250929`, `mistral-large-latest`, `nvidia/...:free`), and
 * users configure whichever one their dashboard shows. Without this the exact
 * lookup misses and every such model silently falls back.
 */
function normalizeModelId(modelId: string): string {
  return modelId
    .replace(/:[^:]*$/, "")
    .replace(/-latest$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "")
    .replace(/-\d{8}$/, "");
}

/**
 * `provider:normalizedId` → metadata, built once on first lookup.
 *
 * Ids are visited in sorted order so that when several collapse to the same
 * normalized key the winner is stable, and the plain alias (`claude-sonnet-4-5`)
 * beats its dated sibling rather than the other way round.
 */
let normalizedIndex: Map<string, GeneratedModelMeta> | undefined;

function getNormalizedIndex(): Map<string, GeneratedModelMeta> {
  if (normalizedIndex) return normalizedIndex;

  const index = new Map<string, GeneratedModelMeta>();
  for (const [provider, models] of Object.entries(GENERATED_MODEL_CATALOG)) {
    for (const modelId of Object.keys(models).sort()) {
      const key = `${provider}:${normalizeModelId(modelId)}`;
      if (!index.has(key)) index.set(key, models[modelId]);
    }
  }

  normalizedIndex = index;
  return index;
}

/**
 * Resolve metadata for one model, in order: exact catalog hit, normalized
 * catalog hit, global fallback — then any hand override layered on top.
 *
 * Always returns a fresh object: callers such as `buildModelFromConfig` layer
 * their own fields on it, and handing out the catalog's own objects would let
 * one call's edit leak into every later lookup.
 */
export function resolveModelMeta(provider: string, modelId: string): ModelMeta {
  const models = GENERATED_MODEL_CATALOG[provider];
  const base =
    models?.[modelId] ??
    getNormalizedIndex().get(`${provider}:${normalizeModelId(modelId)}`) ??
    FALLBACK_MODEL_META;

  return { ...base, ...MODEL_META_OVERRIDES[`${provider}:${modelId}`] };
}
