import assert from "node:assert/strict";
import test from "node:test";
import { getProviderBrandKey } from "../src/pages/model-config/providerBrand.ts";

test("getProviderBrandKey normalizes known providers", () => {
  assert.equal(getProviderBrandKey("deepseek"), "deepseek");
  assert.equal(getProviderBrandKey(" OpenRouter "), "openrouter");
  assert.equal(getProviderBrandKey("azure-openai"), "azure-openai");
});

test("getProviderBrandKey returns null for unknown providers", () => {
  assert.equal(getProviderBrandKey("custom-compat"), null);
  assert.equal(getProviderBrandKey(""), null);
});
