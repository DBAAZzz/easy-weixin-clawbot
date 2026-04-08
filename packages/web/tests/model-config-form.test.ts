import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeModelIdList,
  resolveNextSelectedModel,
} from "../src/pages/model-config/templateForm.ts";

test("normalizeModelIdList trims empties and duplicates", () => {
  assert.deepEqual(
    normalizeModelIdList([" gpt-5 ", "", "gpt-5", "gpt-5-mini "]),
    ["gpt-5", "gpt-5-mini"],
  );
});

test("resolveNextSelectedModel clears invalid model after template switch", () => {
  assert.equal(resolveNextSelectedModel("gpt-5", ["claude-sonnet-4"]), "");
});
