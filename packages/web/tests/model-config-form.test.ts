import assert from "node:assert/strict";
import test from "node:test";
import {
  createEditableModelIdList,
  normalizeModelIdList,
  resolveNextSelectedModel,
} from "../src/pages/model-config/templateForm.ts";
import {
  MODEL_PROVIDER_PRESETS,
} from "../src/pages/model-config/providerPresets.ts";

test("normalizeModelIdList trims empties and duplicates", () => {
  assert.deepEqual(
    normalizeModelIdList([" gpt-5 ", "", "gpt-5", "gpt-5-mini "]),
    ["gpt-5", "gpt-5-mini"],
  );
});

test("resolveNextSelectedModel clears invalid model after template switch", () => {
  assert.equal(resolveNextSelectedModel("gpt-5", ["claude-sonnet-4"]), "");
});

test("createEditableModelIdList appends blank row after suggested models", () => {
  assert.deepEqual(createEditableModelIdList(["deepseek-chat", "deepseek-reasoner"]), [
    "deepseek-chat",
    "deepseek-reasoner",
    "",
  ]);
});

test("createEditableModelIdList falls back to a single blank row when empty", () => {
  assert.deepEqual(createEditableModelIdList([]), [""]);
});

test("DeepSeek preset includes suggested model ids for new templates", () => {
  const deepseekPreset = MODEL_PROVIDER_PRESETS.find(
    (preset) => preset.provider === "deepseek",
  );

  assert.deepEqual(deepseekPreset?.suggestedModelIds, [
    "deepseek-chat",
    "deepseek-reasoner",
  ]);
});
