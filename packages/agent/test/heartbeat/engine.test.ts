import assert from "node:assert/strict";
import test from "node:test";
import type { HeartbeatStore } from "../../src/ports/heartbeat-store.js";
import { setHeartbeatStore } from "../../src/ports/heartbeat-store.js";
import { setChatExecutor } from "../../src/ports/chat-executor.js";
import type { ChatExecutionRequest } from "../../src/ports/chat-executor.js";
import { setPushService } from "../../src/ports/push-service.js";
import type { PushOptions } from "../../src/ports/push-service.js";
import type { ReminderRow } from "../../src/capabilities/heartbeat/types.js";
import { runHeartbeatTick } from "../../src/capabilities/heartbeat/engine.js";

function makeReminder(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: 1n,
    reminderId: "11111111-1111-1111-1111-111111111111",
    accountId: "acc-1",
    conversationId: "conv-1",
    prompt: "问问他面试结果",
    fireAt: new Date("2026-07-28T01:00:00.000Z"),
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    ...overrides,
  };
}

interface Harness {
  store: HeartbeatStore;
  chatCalls: ChatExecutionRequest[];
  pushCalls: Array<{ text: string; opts?: PushOptions }>;
  claimAttempts: string[];
}

function install(options: {
  due: ReminderRow[];
  /** Reminders the store still holds; a claim removes one. */
  claimable?: Set<string>;
  chatResult?: { status: "completed" | "error"; text?: string; error?: string };
  pushThrows?: boolean;
}): Harness {
  const claimable =
    options.claimable ?? new Set(options.due.map((reminder) => reminder.reminderId));
  const byId = new Map(options.due.map((reminder) => [reminder.reminderId, reminder]));

  const chatCalls: ChatExecutionRequest[] = [];
  const pushCalls: Array<{ text: string; opts?: PushOptions }> = [];
  const claimAttempts: string[] = [];

  const store: HeartbeatStore = {
    async createReminder() {
      throw new Error("not used");
    },
    async findDue() {
      return options.due;
    },
    async claimById(reminderId) {
      claimAttempts.push(reminderId);
      if (!claimable.delete(reminderId)) return null;
      return byId.get(reminderId) ?? null;
    },
    async listByAccount() {
      return [];
    },
  };

  setHeartbeatStore(store);

  setChatExecutor({
    async execute(req) {
      chatCalls.push(req);
      return options.chatResult ?? { status: "completed", text: "面试结果怎么样？" };
    },
  });

  setPushService({
    async sendProactiveMessage(_accountId, _conversationId, text, opts) {
      if (options.pushThrows) throw new Error("push failed");
      pushCalls.push({ text, opts });
    },
  });

  return { store, chatCalls, pushCalls, claimAttempts };
}

test("tick runs a due reminder in its real conversation as a trigger turn", async () => {
  const harness = install({ due: [makeReminder()] });

  await runHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.chatCalls.length, 1);
  const [call] = harness.chatCalls;
  assert.equal(call.conversationId, "conv-1");
  assert.equal(call.prompt, "问问他面试结果");
  assert.equal(call.runKind, "heartbeat");
  assert.equal(call.inputRole, "trigger");
  assert.deepEqual(call.triggerMeta, {
    kind: "reminder",
    reminderId: "11111111-1111-1111-1111-111111111111",
  });
});

test("tick pushes without recording history a second time", async () => {
  const harness = install({ due: [makeReminder()] });

  await runHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.pushCalls.length, 1);
  assert.equal(harness.pushCalls[0].text, "面试结果怎么样？");
  assert.equal(harness.pushCalls[0].opts?.recordHistory, false);
});

test("a reminder claimed elsewhere is not run twice", async () => {
  const reminder = makeReminder();
  const harness = install({ due: [reminder, reminder] });

  await runHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.claimAttempts.length, 2);
  assert.equal(harness.chatCalls.length, 1, "only the winning claim runs the reminder");
  assert.equal(harness.pushCalls.length, 1);
});

test("a failed chat drops the reminder instead of retrying", async () => {
  const harness = install({
    due: [makeReminder()],
    chatResult: { status: "error", error: "provider down" },
  });

  await runHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.chatCalls.length, 1);
  assert.equal(harness.pushCalls.length, 0);
  assert.equal(await harness.store.claimById("11111111-1111-1111-1111-111111111111"), null);
});

test("an empty reply pushes nothing", async () => {
  const harness = install({
    due: [makeReminder()],
    chatResult: { status: "completed", text: "   " },
  });

  await runHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.pushCalls.length, 0);
});

test("a failed push does not throw out of the tick", async () => {
  const harness = install({ due: [makeReminder()], pushThrows: true });

  await runHeartbeatTick();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.chatCalls.length, 1);
  assert.equal(harness.pushCalls.length, 0);
});

test("reminders for one account run serially", async () => {
  const due = [
    makeReminder({ reminderId: "a", prompt: "第一条" }),
    makeReminder({ reminderId: "b", prompt: "第二条" }),
  ];
  const order: string[] = [];

  install({ due });

  setChatExecutor({
    async execute(req) {
      order.push(`start:${req.prompt}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${req.prompt}`);
      return { status: "completed", text: "ok" };
    },
  });

  await runHeartbeatTick();
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.deepEqual(order, [
    "start:第一条",
    "end:第一条",
    "start:第二条",
    "end:第二条",
  ]);
});
