/**
 * Hand-written corrections layered over the generated model catalog.
 *
 * This file is for cases where models.dev is wrong, stale, or does not carry a
 * field at all. Everything derivable from upstream belongs in the generator
 * instead — entries here never get refreshed, so each one is a small permanent
 * maintenance cost and should say why it exists.
 *
 * Applied at runtime rather than baked into the generated JSON on purpose: the
 * data files stay a faithful mirror of upstream, so regenerating shows only what
 * actually changed upstream instead of mixing in our edits.
 *
 * Keys are `${provider}:${modelId}`, matched exactly — no `-latest` or date
 * normalization, so an override targets precisely the model id it names.
 */

import type { ModelMeta } from "./types.js";

export const MODEL_META_OVERRIDES: Record<string, Partial<ModelMeta>> = {
  // Example — keep the shape documented even while empty:
  // "openai:gpt-5": { contextWindow: 400_000 },  // upstream still reports 272k
};
