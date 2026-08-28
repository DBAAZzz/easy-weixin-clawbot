import assert from "node:assert/strict";
import test from "node:test";
import { sequenceRange, validateSequencePage } from "./pagination.js";

test("sequence pagination uses exclusive after and inclusive through bounds", () => {
  assert.deepEqual(sequenceRange({ afterSeq: 3, throughSeq: 8, limit: 5 }), {
    gt: 3,
    lte: 8,
  });
});

test("sequence pagination rejects unsafe limits and cursors", () => {
  assert.throws(() => validateSequencePage({ limit: 0 }));
  assert.throws(() => validateSequencePage({ limit: 501 }));
  assert.throws(() => validateSequencePage({ limit: 10, afterSeq: -1 }));
  assert.throws(() => validateSequencePage({ limit: 10, throughSeq: 0 }));
  assert.doesNotThrow(() => validateSequencePage({ limit: 500, afterSeq: 0 }));
});
