import test from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_MODEL_META, resolveModelMeta } from "../../src/llm/model-meta.js";
import { GENERATED_MODEL_CATALOG } from "../../src/llm/models.generated.js";

test("resolveModelMeta reads per-model values from the catalog", () => {
  const haiku = resolveModelMeta("anthropic", "claude-haiku-4-5");
  const sonnet = resolveModelMeta("anthropic", "claude-sonnet-4-6");

  // Same provider, different windows — the case a provider-level default cannot
  // express, and the reason this table is keyed by model.
  assert.notEqual(haiku.contextWindow, sonnet.contextWindow);
  assert.ok(haiku.contextWindow > 0);
  assert.ok(sonnet.contextWindow > 0);
});

test("resolveModelMeta falls back for an unknown model", () => {
  const meta = resolveModelMeta("openai", "some-model-that-does-not-exist");
  assert.deepEqual(meta, FALLBACK_MODEL_META);
});

test("resolveModelMeta falls back for an unknown provider", () => {
  const meta = resolveModelMeta("my-private-relay", "whatever");
  assert.deepEqual(meta, FALLBACK_MODEL_META);
});

/**
 * The failure this normalization exists to prevent: users configure whatever id
 * their provider dashboard shows, which is routinely a dated or aliased variant
 * the catalog does not list verbatim. Without normalization every one of those
 * silently resolved to the fallback — i.e. per-model metadata that never applied.
 */
test("resolveModelMeta matches dated and aliased model ids", () => {
  const base = resolveModelMeta("anthropic", "claude-sonnet-4-6");

  assert.deepEqual(resolveModelMeta("anthropic", "claude-sonnet-4-6-20260217"), base);
  assert.deepEqual(resolveModelMeta("anthropic", "claude-sonnet-4-6-latest"), base);
  assert.notDeepEqual(base, FALLBACK_MODEL_META);
});

test("resolveModelMeta matches openrouter variant suffixes", () => {
  const [modelId] = Object.keys(GENERATED_MODEL_CATALOG.openrouter);
  assert.ok(modelId, "openrouter catalog should not be empty");

  assert.deepEqual(
    resolveModelMeta("openrouter", `${modelId}:free`),
    resolveModelMeta("openrouter", modelId),
  );
});

test("resolveModelMeta returns a fresh object each call", () => {
  const first = resolveModelMeta("anthropic", "claude-haiku-4-5");
  const second = resolveModelMeta("anthropic", "claude-haiku-4-5");

  assert.notEqual(first, second, "callers layer fields on the result");
  assert.deepEqual(first, second);
});

/**
 * A reserve at or above the window drives the trim budget to zero or negative,
 * which the trimmer reads as "drop everything". Upstream reports
 * `output === context` for many models, so this has to hold catalog-wide.
 */
test("every catalog entry leaves a usable context budget", () => {
  for (const [provider, models] of Object.entries(GENERATED_MODEL_CATALOG)) {
    for (const [modelId, meta] of Object.entries(models)) {
      assert.ok(
        meta.maxOutputTokens < meta.contextWindow,
        `${provider}/${modelId}: reserve ${meta.maxOutputTokens} >= window ${meta.contextWindow}`,
      );
      assert.ok(
        Number.isInteger(meta.contextWindow) && meta.contextWindow > 0,
        `${provider}/${modelId}: invalid contextWindow ${meta.contextWindow}`,
      );
    }
  }
});
