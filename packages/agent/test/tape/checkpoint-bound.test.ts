import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "../../src/memory/fold.js";
import { withBoundedDecisions } from "../../src/memory/service.js";
import type { TapeState } from "../../src/memory/types.js";

function stateWithDecisions(count: number): TapeState {
  const state = emptyState();

  for (let i = 0; i < count; i += 1) {
    state.decisions.push({
      description: `d${i}`,
      context: "",
      sourceEid: `e${i}`,
      createdAt: "2026-07-01T00:00:00.000Z",
    });
  }

  return state;
}

test("a short decision timeline is returned untouched", () => {
  const state = stateWithDecisions(10);

  assert.equal(withBoundedDecisions(state), state);
});

test("a long decision timeline keeps only the most recent entries", () => {
  const bounded = withBoundedDecisions(stateWithDecisions(120));

  assert.equal(bounded.decisions.length, 50);
  assert.equal(bounded.decisions[0].description, "d70");
  assert.equal(bounded.decisions.at(-1)?.description, "d119");
});

test("facts and preferences survive checkpoint bounding untouched", () => {
  // The important invariant: unlike a handoff, a checkpoint must not drop
  // low-confidence facts. Their source entries get marked compacted and later
  // purged, so anything dropped here is gone for good.
  const state = stateWithDecisions(120);
  state.facts.set("shaky", {
    key: "shaky",
    value: "可能",
    confidence: 0.2,
    sourceEid: "e-shaky",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  state.facts.set("solid", {
    key: "solid",
    value: "确定",
    confidence: 1,
    sourceEid: "e-solid",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });
  state.preferences.set("tone", {
    key: "tone",
    value: "简洁",
    sourceEid: "e-tone",
    updatedAt: "2026-07-01T00:00:00.000Z",
  });

  const bounded = withBoundedDecisions(state);

  assert.equal(bounded.facts.size, 2);
  assert.equal(bounded.facts.get("shaky")?.value, "可能");
  assert.equal(bounded.preferences.size, 1);
  assert.equal(bounded.version, state.version);
});

test("bounding does not mutate the input state", () => {
  const state = stateWithDecisions(120);

  withBoundedDecisions(state);

  assert.equal(state.decisions.length, 120);
});
