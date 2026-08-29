import assert from "node:assert/strict";
import test from "node:test";
import type { HeartbeatStore } from "../../src/ports/heartbeat-store.js";
import { setHeartbeatStore } from "../../src/ports/heartbeat-store.js";
import { setChatExecutor } from "../../src/ports/chat-executor.js";
import type { ChatExecutionRequest } from "../../src/ports/chat-executor.js";
import { setPushService } from "../../src/ports/push-service.js";
import type { PushOptions } from "../../src/ports/push-service.js";
import type {
  PulseRow,
  PulseUpdate,
  PulseVerdict,
} from "../../src/capabilities/heartbeat/types.js";
import {
  runHeartbeatTick,
  notePulseActivity,
} from "../../src/capabilities/heartbeat/engine.js";
import { PULSE_MIN_MINUTES } from "../../src/capabilities/heartbeat/types.js";

const HOUR_MS = 3600_000;

/**
 * Fixed clock inside the awake window (14:00 Asia/Shanghai) — the suite would
 * otherwise fail whenever CI runs during quiet hours (23:00–08:00).
 */
const NOW = new Date("2026-08-28T14:00:00.000+08:00");

function makePulse(overrides: Partial<PulseRow> = {}): PulseRow {
  return {
    id: 1n,
    accountId: "acc-1",
    conversationId: "conv-1",
    nextEvalAt: new Date(NOW.getTime() - 60_000),
    lastUserAt: new Date(NOW.getTime() - 6 * HOUR_MS),
    lastSpokeAt: null,
    quietStreak: 2,
    spokenDateKey: null,
    spokenToday: 0,
    ...overrides,
  };
}

interface Harness {
  chatCalls: ChatExecutionRequest[];
  pushCalls: Array<{ text: string; opts?: PushOptions }>;
  verdicts: Array<{ id: bigint; updates: PulseUpdate }>;
  claims: bigint[];
  activity: Array<{ accountId: string; conversationId: string; nextEvalAt: Date }>;
}

function install(options: {
  due: PulseRow[];
  claimable?: Set<string>;
  chatResult?: { status: "completed" | "error"; text?: string; error?: string };
  pushThrows?: boolean;
}): Harness {
  const claimable = options.claimable ?? new Set(options.due.map((p) => p.id.toString()));

  const harness: Harness = {
    chatCalls: [],
    pushCalls: [],
    verdicts: [],
    claims: [],
    activity: [],
  };

  const store: HeartbeatStore = {
    async notePulseActivity(accountId, conversationId, _now, nextEvalAt) {
      harness.activity.push({ accountId, conversationId, nextEvalAt });
    },
    async findDuePulses() {
      return options.due;
    },
    async claimForEval(id) {
      harness.claims.push(id);
      return claimable.delete(id.toString());
    },
    async applyVerdict(id, updates) {
      harness.verdicts.push({ id, updates });
    },
  };

  setHeartbeatStore(store);

  setChatExecutor({
    async execute(req) {
      harness.chatCalls.push(req);
      return options.chatResult ?? { status: "completed", text: "面试结果怎么样？" };
    },
  });

  setPushService({
    async sendProactiveMessage(_accountId, _conversationId, text, opts) {
      if (options.pushThrows) throw new Error("push failed");
      harness.pushCalls.push({ text, opts });
    },
  });

  return harness;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** The real evaluator calls an LLM; tests hand the tick a stand-in instead. */
function verdict(overrides: Partial<PulseVerdict> = {}): PulseVerdict {
  return {
    speak: true,
    reason: "面试该有结果了",
    prompt: "问问他面试结果",
    nextEvalInMinutes: 120,
    ...overrides,
  };
}

const SPEAKS = async () => verdict();
const STAYS_QUIET = async () => verdict({ speak: false, prompt: null, nextEvalInMinutes: 180 });

test("a pulse the tick could not claim is not evaluated", async () => {
  const harness = install({ due: [makePulse()], claimable: new Set() });

  await runHeartbeatTick(SPEAKS, NOW);
  await settle();

  assert.deepEqual(harness.claims, [1n]);
  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.verdicts.length, 0);
});

test("speaking runs chat in the real conversation as a pulse trigger", async () => {
  const harness = install({ due: [makePulse()] });

  await runHeartbeatTick(SPEAKS, NOW);
  await settle();

  assert.equal(harness.chatCalls.length, 1);
  const [call] = harness.chatCalls;
  assert.equal(call.conversationId, "conv-1");
  assert.equal(call.prompt, "问问他面试结果");
  assert.equal(call.runKind, "heartbeat");
  assert.equal(call.inputRole, "trigger");
  assert.deepEqual(call.triggerMeta, { kind: "pulse" });
});

test("speaking pushes without recording history a second time", async () => {
  const harness = install({ due: [makePulse()] });

  await runHeartbeatTick(SPEAKS, NOW);
  await settle();

  assert.equal(harness.pushCalls.length, 1);
  assert.equal(harness.pushCalls[0].opts?.recordHistory, false);
});

test("speaking resets the quiet streak and bumps the daily count", async () => {
  const harness = install({ due: [makePulse({ quietStreak: 3 })] });

  await runHeartbeatTick(SPEAKS, NOW);
  await settle();

  const [{ updates }] = harness.verdicts;
  assert.equal(updates.quietStreak, 0);
  assert.equal(updates.spokenToday, 1);
  assert.ok(updates.lastSpokeAt);
});

test("staying quiet increments the streak and never pushes", async () => {
  const harness = install({ due: [makePulse({ quietStreak: 2 })] });

  await runHeartbeatTick(STAYS_QUIET, NOW);
  await settle();

  assert.equal(harness.chatCalls.length, 0);
  assert.equal(harness.pushCalls.length, 0);
  assert.equal(harness.verdicts[0].updates.quietStreak, 3);
});

test("a failed chat counts as staying quiet and is not retried", async () => {
  const harness = install({
    due: [makePulse({ quietStreak: 1 })],
    chatResult: { status: "error", error: "provider down" },
  });

  await runHeartbeatTick(SPEAKS, NOW);
  await settle();

  assert.equal(harness.chatCalls.length, 1);
  assert.equal(harness.pushCalls.length, 0);
  assert.equal(harness.verdicts[0].updates.quietStreak, 2);
  assert.equal(harness.verdicts[0].updates.lastSpokeAt, undefined);
});

test("an empty reply pushes nothing", async () => {
  const harness = install({
    due: [makePulse()],
    chatResult: { status: "completed", text: "   " },
  });

  await runHeartbeatTick(SPEAKS, NOW);
  await settle();

  assert.equal(harness.pushCalls.length, 0);
});

test("a failed push does not throw out of the tick", async () => {
  const harness = install({ due: [makePulse()], pushThrows: true });

  await runHeartbeatTick(SPEAKS, NOW);
  await settle();

  assert.equal(harness.chatCalls.length, 1);
  assert.equal(harness.pushCalls.length, 0);
  assert.equal(harness.verdicts.length, 1, "the pulse is still rescheduled");
});

test("pulses for one account are evaluated serially", async () => {
  const order: string[] = [];
  const slowQuiet = async (pulse: PulseRow): Promise<PulseVerdict> => {
    order.push(`start:${pulse.conversationId}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(`end:${pulse.conversationId}`);
    return verdict({ speak: false, prompt: null });
  };

  install({
    due: [
      makePulse({ id: 1n, conversationId: "conv-a" }),
      makePulse({ id: 2n, conversationId: "conv-b" }),
    ],
  });

  await runHeartbeatTick(slowQuiet, NOW);
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.deepEqual(order, [
    "start:conv-a",
    "end:conv-a",
    "start:conv-b",
    "end:conv-b",
  ]);
});

test("notePulseActivity pushes the next evaluation out", async () => {
  const harness = install({ due: [] });
  const before = Date.now();

  await notePulseActivity("acc-1", "conv-1");

  assert.equal(harness.activity.length, 1);
  const delayMinutes = Math.round(
    (harness.activity[0].nextEvalAt.getTime() - before) / 60_000,
  );
  assert.equal(delayMinutes, PULSE_MIN_MINUTES);
});
