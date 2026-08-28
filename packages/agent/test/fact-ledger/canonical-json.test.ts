import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeJson,
  parseJsonValue,
  sha256CanonicalJson,
} from "../../src/shared/fact-ledger/index.js";

test("canonical JSON sorts object keys but preserves array order", () => {
  assert.equal(
    canonicalizeJson({ z: 1, a: { y: true, x: null }, list: [3, 2, 1] }),
    '{"a":{"x":null,"y":true},"list":[3,2,1],"z":1}',
  );
  assert.notEqual(canonicalizeJson([1, 2]), canonicalizeJson([2, 1]));
});

test("canonical JSON follows ECMAScript number serialization", () => {
  assert.equal(canonicalizeJson(-0), "0");
  assert.equal(canonicalizeJson(1e30), "1e+30");
  assert.equal(canonicalizeJson(0.002), "0.002");
});

test("JSON contract and canonicalizer reject the same lossy values", () => {
  const arrayWithExtra = [1, 2] as number[] & { foo?: number };
  arrayWithExtra.foo = 123;

  for (const invalid of [Number.NaN, { missing: undefined }, "\ud800", arrayWithExtra]) {
    assert.throws(() => parseJsonValue(invalid));
    assert.throws(() => canonicalizeJson(invalid));
  }
});

test("canonical JSON SHA-256 hashes UTF-8 canonical bytes", () => {
  assert.equal(
    sha256CanonicalJson({}),
    "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  );
  assert.equal(sha256CanonicalJson({ b: 2, a: 1 }), sha256CanonicalJson({ a: 1, b: 2 }));
});
