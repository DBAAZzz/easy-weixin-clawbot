import assert from "node:assert/strict";
import test from "node:test";
import {
  deserializeState,
  emptyState,
  fold,
  serializeState,
} from "../../src/memory/fold.js";
import type { TapeState } from "../../src/memory/types.js";

const AT = "2026-07-01T00:00:00.000Z";

function entry(
  category: string,
  data: Array<Record<string, unknown>>,
  overrides: { eid?: string; createdAt?: Date | string } = {},
) {
  return {
    eid: overrides.eid ?? "e1",
    category,
    payload: { fragments: data.map((d) => ({ kind: "text", data: d })) },
    createdAt: overrides.createdAt ?? AT,
  };
}

test("fact fragments fold into keyed facts with provenance", () => {
  const state = fold(
    emptyState(),
    entry("fact", [{ key: "city", value: "杭州", confidence: 0.9 }], { eid: "e7" }),
  );

  assert.deepEqual(state.facts.get("city"), {
    key: "city",
    value: "杭州",
    confidence: 0.9,
    sourceEid: "e7",
    updatedAt: AT,
  });
  assert.equal(state.version, 1);
});

test("facts default to confidence 1 and skip fragments without a key", () => {
  const state = fold(
    emptyState(),
    entry("fact", [{ key: "job", value: "工程师" }, { value: "无 key" }]),
  );

  assert.equal(state.facts.get("job")?.confidence, 1);
  assert.equal(state.facts.size, 1);
});

test("same fact key is last-write-wins and carries the newer sourceEid", () => {
  const first = fold(emptyState(), entry("fact", [{ key: "city", value: "杭州" }], { eid: "e1" }));
  const second = fold(
    first,
    entry("fact", [{ key: "city", value: "上海" }], {
      eid: "e2",
      createdAt: "2026-07-02T00:00:00.000Z",
    }),
  );

  assert.equal(second.facts.size, 1);
  assert.equal(second.facts.get("city")?.value, "上海");
  assert.equal(second.facts.get("city")?.sourceEid, "e2");
  assert.equal(second.facts.get("city")?.updatedAt, "2026-07-02T00:00:00.000Z");
});

test("preferences are keyed and last-write-wins", () => {
  const first = fold(emptyState(), entry("preference", [{ key: "tone", value: "简洁" }]));
  const second = fold(
    first,
    entry("preference", [{ key: "tone", value: "详细" }], { eid: "e2" }),
  );

  assert.equal(second.preferences.size, 1);
  assert.equal(second.preferences.get("tone")?.value, "详细");
});

test("decisions append without dedup — they are timeline events", () => {
  const first = fold(emptyState(), entry("decision", [{ description: "改用方案 A" }]));
  const second = fold(first, entry("decision", [{ description: "改用方案 A" }], { eid: "e2" }));

  assert.equal(second.decisions.length, 2);
  assert.deepEqual(
    second.decisions.map((d) => d.sourceEid),
    ["e1", "e2"],
  );
});

test("decision fields fall back to empty strings", () => {
  const state = fold(emptyState(), entry("decision", [{}]));

  assert.deepEqual(state.decisions[0], {
    description: "",
    context: "",
    sourceEid: "e1",
    createdAt: AT,
  });
});

test("summary entries bulk-merge pre-folded state", () => {
  const state = fold(
    emptyState(),
    entry("summary", [
      {
        facts: {
          city: { key: "city", value: "杭州", confidence: 1, sourceEid: "e0", updatedAt: AT },
        },
        preferences: {
          tone: { key: "tone", value: "简洁", sourceEid: "e0", updatedAt: AT },
        },
        decisions: [{ description: "d1", context: "", sourceEid: "e0", createdAt: AT }],
      },
    ]),
  );

  assert.equal(state.facts.get("city")?.value, "杭州");
  assert.equal(state.preferences.get("tone")?.value, "简洁");
  assert.equal(state.decisions.length, 1);
});

test("a Date createdAt is normalized to an ISO string", () => {
  const state = fold(
    emptyState(),
    entry("fact", [{ key: "k", value: "v" }], { createdAt: new Date(AT) }),
  );

  assert.equal(state.facts.get("k")?.updatedAt, AT);
});

test("unknown categories only bump the version", () => {
  const state = fold(emptyState(), entry("unknown-category", [{ key: "k", value: "v" }]));

  assert.equal(state.facts.size, 0);
  assert.equal(state.preferences.size, 0);
  assert.equal(state.decisions.length, 0);
  assert.equal(state.version, 1);
});

test("fold does not mutate the input state", () => {
  const before = fold(emptyState(), entry("fact", [{ key: "a", value: 1 }]));
  const snapshot = {
    facts: new Map(before.facts),
    decisions: [...before.decisions],
    version: before.version,
  };

  fold(before, entry("fact", [{ key: "b", value: 2 }], { eid: "e2" }));
  fold(before, entry("decision", [{ description: "d" }], { eid: "e3" }));

  assert.deepEqual([...before.facts.keys()], [...snapshot.facts.keys()]);
  assert.equal(before.decisions.length, snapshot.decisions.length);
  assert.equal(before.version, snapshot.version);
});

test("serialize/deserialize round-trips a state", () => {
  const state: TapeState = fold(
    fold(emptyState(), entry("fact", [{ key: "city", value: "杭州" }])),
    entry("decision", [{ description: "d1" }], { eid: "e2" }),
  );

  const restored = deserializeState(serializeState(state));

  assert.deepEqual([...restored.facts.entries()], [...state.facts.entries()]);
  assert.deepEqual(restored.decisions, state.decisions);
  assert.equal(restored.version, state.version);
});

test("deserialize tolerates a snapshot missing fields", () => {
  const restored = deserializeState({});

  assert.equal(restored.facts.size, 0);
  assert.equal(restored.preferences.size, 0);
  assert.deepEqual(restored.decisions, []);
  assert.equal(restored.version, 0);
});
