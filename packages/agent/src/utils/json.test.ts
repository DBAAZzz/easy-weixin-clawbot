import assert from "node:assert/strict";
import test from "node:test";
import { extractJsonBlock } from "./json.js";

test("extractJsonBlock returns raw object span", () => {
  assert.equal(extractJsonBlock('{"a":1}'), '{"a":1}');
});

test("extractJsonBlock unwraps a ```json fenced block", () => {
  const text = 'prefix\n```json\n{"a":1}\n```\nsuffix';
  assert.equal(extractJsonBlock(text), '{"a":1}');
});

test("extractJsonBlock unwraps a bare fenced block", () => {
  assert.equal(extractJsonBlock('```\n{"a":1}\n```'), '{"a":1}');
});

test("extractJsonBlock takes the first-brace-to-last-brace span amid prose", () => {
  assert.equal(extractJsonBlock('verdict: {"a":1}.'), '{"a":1}');
});

test("extractJsonBlock returns null when no object is present", () => {
  assert.equal(extractJsonBlock("no json here"), null);
});
