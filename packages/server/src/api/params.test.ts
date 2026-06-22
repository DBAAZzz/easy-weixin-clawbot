import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLimitParam,
  parsePositiveBigIntParam,
  parsePositiveIntParam,
} from "./params.js";

test("parsePositiveIntParam accepts only complete safe positive integers", () => {
  assert.equal(parsePositiveIntParam("1"), 1);
  assert.equal(parsePositiveIntParam("001"), null);
  assert.equal(parsePositiveIntParam("1abc"), null);
  assert.equal(parsePositiveIntParam("0"), null);
  assert.equal(parsePositiveIntParam("-1"), null);
  assert.equal(parsePositiveIntParam("9007199254740992"), null);
  assert.equal(parsePositiveIntParam(undefined), null);
});

test("parsePositiveBigIntParam accepts only complete positive integer strings", () => {
  assert.equal(parsePositiveBigIntParam("1"), 1n);
  assert.equal(parsePositiveBigIntParam("12345678901234567890"), 12345678901234567890n);
  assert.equal(parsePositiveBigIntParam("001"), null);
  assert.equal(parsePositiveBigIntParam("1abc"), null);
  assert.equal(parsePositiveBigIntParam("0"), null);
  assert.equal(parsePositiveBigIntParam("-1"), null);
  assert.equal(parsePositiveBigIntParam(undefined), null);
});

test("parseLimitParam falls back for invalid input and caps valid limits", () => {
  assert.equal(parseLimitParam(undefined), 20);
  assert.equal(parseLimitParam("abc"), 20);
  assert.equal(parseLimitParam("0"), 20);
  assert.equal(parseLimitParam("10"), 10);
  assert.equal(parseLimitParam("500"), 100);
});
