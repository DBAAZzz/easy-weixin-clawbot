import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePulseVerdict,
  applyPulseGuards,
  isQuietHour,
  localDateKey,
} from "../../src/capabilities/heartbeat/evaluator.js";
import type { PulseRow, PulseVerdict } from "../../src/capabilities/heartbeat/types.js";
import {
  PULSE_MIN_MINUTES,
  PULSE_MAX_MINUTES,
  PULSE_MAX_PER_DAY,
} from "../../src/capabilities/heartbeat/types.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3600_000;

/** 2026-07-27 12:00 Asia/Shanghai — comfortably outside quiet hours. */
const NOON = new Date("2026-07-27T04:00:00.000Z");

function makePulse(overrides: Partial<PulseRow> = {}): PulseRow {
  return {
    id: 1n,
    accountId: "acc-1",
    conversationId: "conv-1",
    nextEvalAt: NOON,
    lastUserAt: new Date(NOON.getTime() - 6 * HOUR_MS),
    lastSpokeAt: null,
    quietStreak: 0,
    spokenDateKey: null,
    spokenToday: 0,
    ...overrides,
  };
}

function speakVerdict(overrides: Partial<PulseVerdict> = {}): PulseVerdict {
  return {
    speak: true,
    reason: "面试该有结果了",
    prompt: "问问他昨天的面试结果",
    nextEvalInMinutes: 120,
    ...overrides,
  };
}

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MINUTE_MS);
}

// ── Parsing ────────────────────────────────────────────────────────

test("parsePulseVerdict reads a well-formed verdict", () => {
  const verdict = parsePulseVerdict(
    '{"speak":true,"reason":"面试该有结果了","prompt":"问问他面试结果","next_eval_in_minutes":120}',
  );

  assert.equal(verdict.speak, true);
  assert.equal(verdict.prompt, "问问他面试结果");
  assert.equal(verdict.nextEvalInMinutes, 120);
});

test("parsePulseVerdict recovers a verdict wrapped in prose or fences", () => {
  const verdict = parsePulseVerdict(
    '好的，我的判断是：\n```json\n{"speak":false,"reason":"他在忙","prompt":null,"next_eval_in_minutes":180}\n```',
  );

  assert.equal(verdict.speak, false);
  assert.equal(verdict.nextEvalInMinutes, 180);
});

test("parsePulseVerdict degrades unparseable output to staying quiet", () => {
  const verdict = parsePulseVerdict("我觉得现在可以找他聊聊天气");

  assert.equal(verdict.speak, false, "malformed output must never reach a user");
  assert.equal(verdict.reason, "parse_failed");
  assert.equal(verdict.nextEvalInMinutes, 240);
});

test("parsePulseVerdict treats a speak verdict with no prompt as promptless", () => {
  const verdict = parsePulseVerdict('{"speak":true,"reason":"x","prompt":"  ","next_eval_in_minutes":60}');

  assert.equal(verdict.speak, true);
  assert.equal(verdict.prompt, null);
});

// ── Scheduling constraints ─────────────────────────────────────────

test("applyPulseGuards clamps the requested delay into range", () => {
  const low = applyPulseGuards(makePulse(), speakVerdict({ nextEvalInMinutes: 5 }), NOON);
  assert.equal(minutesBetween(NOON, low.nextEvalAt), PULSE_MIN_MINUTES);

  const high = applyPulseGuards(makePulse(), speakVerdict({ nextEvalInMinutes: 99_999 }), NOON);
  assert.equal(minutesBetween(NOON, high.nextEvalAt), PULSE_MAX_MINUTES);
});

test("applyPulseGuards backs off exponentially with the quiet streak", () => {
  const floors = [0, 1, 2, 3].map((quietStreak) =>
    minutesBetween(
      NOON,
      applyPulseGuards(
        makePulse({ quietStreak }),
        speakVerdict({ speak: false, prompt: null, nextEvalInMinutes: 1 }),
        NOON,
      ).nextEvalAt,
    ),
  );

  assert.deepEqual(floors, [30, 60, 120, 240]);
});

test("applyPulseGuards caps the backoff at one day", () => {
  const decision = applyPulseGuards(
    makePulse({ quietStreak: 20 }),
    speakVerdict({ speak: false, prompt: null, nextEvalInMinutes: 1 }),
    NOON,
  );

  assert.equal(minutesBetween(NOON, decision.nextEvalAt), PULSE_MAX_MINUTES);
});

test("applyPulseGuards doubles the floor when the user never answered", () => {
  const unanswered = makePulse({
    lastSpokeAt: new Date(NOON.getTime() - 10 * HOUR_MS),
    lastUserAt: new Date(NOON.getTime() - 30 * HOUR_MS),
  });

  const decision = applyPulseGuards(
    unanswered,
    speakVerdict({ speak: false, prompt: null, nextEvalInMinutes: 1 }),
    NOON,
  );

  assert.equal(minutesBetween(NOON, decision.nextEvalAt), PULSE_MIN_MINUTES * 2);
});

// ── Restraint rules ────────────────────────────────────────────────

test("applyPulseGuards lets a clean verdict speak", () => {
  const decision = applyPulseGuards(makePulse(), speakVerdict(), NOON);

  assert.equal(decision.speak, true);
  assert.equal(decision.prompt, "问问他昨天的面试结果");
  assert.equal(decision.blockedBy, undefined);
});

test("applyPulseGuards refuses to speak without a prompt", () => {
  const decision = applyPulseGuards(makePulse(), speakVerdict({ prompt: null }), NOON);

  assert.equal(decision.speak, false);
  assert.equal(decision.blockedBy, "missing_prompt");
});

test("applyPulseGuards stays silent at night and waits for morning", () => {
  // 2026-07-27 23:30 Asia/Shanghai
  const lateNight = new Date("2026-07-27T15:30:00.000Z");
  assert.equal(isQuietHour(lateNight), true);

  const decision = applyPulseGuards(makePulse(), speakVerdict(), lateNight);

  assert.equal(decision.speak, false);
  assert.equal(decision.blockedBy, "quiet_hours");
  assert.equal(
    minutesBetween(lateNight, decision.nextEvalAt),
    8 * 60 + 30,
    "should resume at 08:00 local",
  );
});

test("applyPulseGuards enforces the daily cap", () => {
  const capped = makePulse({
    spokenDateKey: localDateKey(NOON),
    spokenToday: PULSE_MAX_PER_DAY,
    lastSpokeAt: new Date(NOON.getTime() - 10 * HOUR_MS),
    lastUserAt: new Date(NOON.getTime() - 5 * HOUR_MS),
  });

  const decision = applyPulseGuards(capped, speakVerdict(), NOON);

  assert.equal(decision.speak, false);
  assert.equal(decision.blockedBy, "daily_cap");
});

test("applyPulseGuards ignores a stale daily counter from another day", () => {
  const yesterday = makePulse({
    spokenDateKey: "2026-07-26",
    spokenToday: PULSE_MAX_PER_DAY,
  });

  assert.equal(applyPulseGuards(yesterday, speakVerdict(), NOON).speak, true);
});

test("applyPulseGuards enforces a minimum gap between proactive messages", () => {
  const justSpoke = makePulse({
    lastSpokeAt: new Date(NOON.getTime() - HOUR_MS),
    lastUserAt: new Date(NOON.getTime() - 30 * MINUTE_MS),
  });

  const decision = applyPulseGuards(justSpoke, speakVerdict(), NOON);

  assert.equal(decision.speak, false);
  assert.equal(decision.blockedBy, "min_gap");
});

test("a blocked verdict still reschedules — the pulse keeps beating", () => {
  for (const verdict of [
    speakVerdict({ prompt: null }),
    speakVerdict({ speak: false, prompt: null }),
  ]) {
    const decision = applyPulseGuards(makePulse(), verdict, NOON);
    assert.ok(decision.nextEvalAt > NOON, "nextEvalAt must always move forward");
  }
});
