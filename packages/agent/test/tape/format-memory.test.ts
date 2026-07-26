import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "../../src/memory/fold.js";
import { formatMemoryForPrompt } from "../../src/memory/service.js";
import type { TapeState } from "../../src/memory/types.js";

function stateWith(input: {
  facts?: Array<[string, unknown, string?]>;
  preferences?: Array<[string, unknown, string?]>;
  decisions?: Array<[string, string?]>;
}): TapeState {
  const state = emptyState();

  for (const [key, value, updatedAt] of input.facts ?? []) {
    state.facts.set(key, {
      key,
      value,
      confidence: 1,
      sourceEid: `e-${key}`,
      updatedAt: updatedAt ?? "2026-07-01T00:00:00.000Z",
    });
  }

  for (const [key, value, updatedAt] of input.preferences ?? []) {
    state.preferences.set(key, {
      key,
      value,
      sourceEid: `e-${key}`,
      updatedAt: updatedAt ?? "2026-07-01T00:00:00.000Z",
    });
  }

  for (const [description, context] of input.decisions ?? []) {
    state.decisions.push({
      description,
      context: context ?? "",
      sourceEid: `e-${description}`,
      createdAt: "2026-07-01T00:00:00.000Z",
    });
  }

  return state;
}

test("empty memory produces no prompt section", () => {
  assert.equal(formatMemoryForPrompt(emptyState(), emptyState()), "");
});

test("facts and preferences render inside a single <memory> block", () => {
  const output = formatMemoryForPrompt(
    stateWith({ facts: [["city", "杭州"]], preferences: [["tone", "简洁"]] }),
    emptyState(),
  );

  assert.match(output, /^<memory>\n/);
  assert.match(output, /\n<\/memory>$/);
  assert.match(output, /## 已知事实\n- city: "杭州"/);
  assert.match(output, /## 用户偏好\n- tone: "简洁"/);
});

test("session memory overrides global memory on the same key", () => {
  const output = formatMemoryForPrompt(
    stateWith({ facts: [["city", "杭州"]] }),
    stateWith({ facts: [["city", "上海"]] }),
  );

  assert.match(output, /- city: "上海"/);
  assert.doesNotMatch(output, /杭州/);
});

test("global and session facts are merged, not replaced", () => {
  const output = formatMemoryForPrompt(
    stateWith({ facts: [["city", "杭州"]] }),
    stateWith({ facts: [["job", "工程师"]] }),
  );

  assert.match(output, /- city: "杭州"/);
  assert.match(output, /- job: "工程师"/);
});

test("only the last 5 session decisions are injected, and global decisions are not", () => {
  const output = formatMemoryForPrompt(
    stateWith({ decisions: [["全局决策"]] }),
    stateWith({
      decisions: [["d1"], ["d2"], ["d3"], ["d4"], ["d5"], ["d6"]],
    }),
  );

  assert.doesNotMatch(output, /全局决策/);
  assert.doesNotMatch(output, /- d1$/m);
  for (const kept of ["d2", "d3", "d4", "d5", "d6"]) {
    assert.match(output, new RegExp(`- ${kept}`));
  }
});

test("decision context is appended in parentheses when present", () => {
  const output = formatMemoryForPrompt(
    emptyState(),
    stateWith({ decisions: [["改用方案 A", "性能更好"]] }),
  );

  assert.match(output, /- 改用方案 A \(性能更好\)/);
});

test("sections are omitted when their category is empty", () => {
  const output = formatMemoryForPrompt(emptyState(), stateWith({ decisions: [["d1"]] }));

  assert.doesNotMatch(output, /## 已知事实/);
  assert.doesNotMatch(output, /## 用户偏好/);
  assert.match(output, /## 近期决策/);
});

// ── token budget ──────────────────────────────────────────────────

/** 200 facts is far past any sane budget. */
function manyFacts(count: number) {
  return Array.from({ length: count }, (_, i): [string, unknown, string] => [
    `k${String(i).padStart(3, "0")}`,
    `v${i}`,
    `2026-07-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  ]);
}

test("a memory within budget renders no truncation notice", () => {
  const output = formatMemoryForPrompt(
    stateWith({ facts: [["city", "杭州"]] }),
    emptyState(),
  );

  assert.doesNotMatch(output, /已省略/);
});

test("an oversized memory is trimmed and says so", () => {
  const output = formatMemoryForPrompt(stateWith({ facts: manyFacts(200) }), emptyState());

  const rendered = output.match(/^- k\d{3}: /gm) ?? [];
  const notice = output.match(/已省略 (\d+) 条较早内容/);

  assert.ok(rendered.length > 0, "应保留部分事实");
  assert.ok(rendered.length < 200, "应发生截断");
  assert.ok(notice, "截断时必须提示模型记忆不完整");
  assert.equal(Number(notice![1]), 200 - rendered.length);
});

test("trimming keeps the most recently updated facts", () => {
  const output = formatMemoryForPrompt(
    stateWith({
      facts: [
        ["oldest", "a", "2020-01-01T00:00:00.000Z"],
        ["newest", "b", "2026-07-20T00:00:00.000Z"],
        ["middle", "c", "2024-01-01T00:00:00.000Z"],
      ],
    }),
    emptyState(),
    { maxTokens: 22 },
  );

  assert.match(output, /- newest: "b"/);
  assert.doesNotMatch(output, /- oldest: "a"/);
});

test("surviving lines keep their original order, not recency order", () => {
  const output = formatMemoryForPrompt(
    stateWith({
      facts: [
        ["alpha", "a", "2020-01-01T00:00:00.000Z"],
        ["beta", "b", "2026-07-20T00:00:00.000Z"],
        ["gamma", "c", "2026-07-21T00:00:00.000Z"],
      ],
    }),
    emptyState(),
    { maxTokens: 26 },
  );

  const keys = [...output.matchAll(/^- (\w+): /gm)].map((m) => m[1]);
  assert.deepEqual(keys, ["beta", "gamma"]);
});

test("preferences claim the budget before facts", () => {
  // Budget fits roughly one line: whichever category is served first wins it.
  const output = formatMemoryForPrompt(
    stateWith({
      facts: manyFacts(200),
      preferences: [["tone", "简洁"]],
    }),
    emptyState(),
    { maxTokens: 20 },
  );

  assert.match(output, /- tone: "简洁"/);
  assert.doesNotMatch(output, /## 已知事实/);
});

test("maxTokens Infinity disables trimming", () => {
  const output = formatMemoryForPrompt(stateWith({ facts: manyFacts(200) }), emptyState(), {
    maxTokens: Number.POSITIVE_INFINITY,
  });

  assert.equal((output.match(/^- k\d{3}: /gm) ?? []).length, 200);
  assert.doesNotMatch(output, /已省略/);
});

test("an exhausted budget still drops decisions rather than overflowing", () => {
  const output = formatMemoryForPrompt(
    stateWith({ facts: manyFacts(200) }),
    stateWith({ decisions: [["d1"], ["d2"]] }),
    { maxTokens: 20 },
  );

  assert.doesNotMatch(output, /## 近期决策/);
  assert.match(output, /已省略/);
});
