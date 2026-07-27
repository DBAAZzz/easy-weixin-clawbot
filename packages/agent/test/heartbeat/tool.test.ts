import assert from "node:assert/strict";
import test from "node:test";
import type { HeartbeatStore } from "../../src/ports/heartbeat-store.js";
import { setHeartbeatStore } from "../../src/ports/heartbeat-store.js";
import type { CreateReminderInput, ReminderRow } from "../../src/capabilities/heartbeat/types.js";
import { MAX_PENDING_PER_ACCOUNT } from "../../src/capabilities/heartbeat/types.js";
import { heartbeatToolRegistry } from "../../src/capabilities/heartbeat/tool.js";

const abortSignal = new AbortController().signal;

const CHAT_CTX = {
  signal: abortSignal,
  accountId: "acc-1",
  conversationId: "conv-1",
  runKind: "chat" as const,
};

function makeReminder(input: CreateReminderInput): ReminderRow {
  return {
    id: 1n,
    reminderId: "11111111-1111-1111-1111-111111111111",
    accountId: input.accountId,
    conversationId: input.conversationId,
    prompt: input.prompt,
    fireAt: input.fireAt,
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
  };
}

function createStore(overrides: Partial<HeartbeatStore> = {}): HeartbeatStore {
  return {
    async createReminder(input) {
      return makeReminder(input);
    },
    async findDue() {
      return [];
    },
    async claimById() {
      return null;
    },
    async listByAccount() {
      return [];
    },
    ...overrides,
  };
}

function textOf(result: Awaited<ReturnType<typeof heartbeatToolRegistry.execute>>): string {
  return result
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

test("create_reminder stores the reminder against the current conversation", async () => {
  let created: CreateReminderInput | undefined;
  setHeartbeatStore(
    createStore({
      async createReminder(input) {
        created = input;
        return makeReminder(input);
      },
    }),
  );

  const fireAt = isoIn(3600_000);
  const result = await heartbeatToolRegistry.execute(
    "create_reminder",
    { fire_at: fireAt, prompt: "问问他面试结果" },
    CHAT_CTX,
  );

  assert.equal(created?.accountId, "acc-1");
  assert.equal(created?.conversationId, "conv-1");
  assert.equal(created?.prompt, "问问他面试结果");
  assert.equal(created?.fireAt.toISOString(), new Date(fireAt).toISOString());
  assert.match(textOf(result), /已安排提醒/);
});

test("create_reminder rejects a fire_at in the past", async () => {
  let created = false;
  setHeartbeatStore(
    createStore({
      async createReminder(input) {
        created = true;
        return makeReminder(input);
      },
    }),
  );

  const result = await heartbeatToolRegistry.execute(
    "create_reminder",
    { fire_at: isoIn(-60_000), prompt: "迟到的提醒" },
    CHAT_CTX,
  );

  assert.equal(created, false);
  assert.match(textOf(result), /已过去/);
});

test("create_reminder rejects a fire_at beyond seven days", async () => {
  let created = false;
  setHeartbeatStore(
    createStore({
      async createReminder(input) {
        created = true;
        return makeReminder(input);
      },
    }),
  );

  const result = await heartbeatToolRegistry.execute(
    "create_reminder",
    { fire_at: isoIn(8 * 24 * 3600_000), prompt: "太远了" },
    CHAT_CTX,
  );

  assert.equal(created, false);
  assert.match(textOf(result), /最远只能安排/);
});

test("create_reminder rejects an unparseable fire_at", async () => {
  setHeartbeatStore(createStore());

  const result = await heartbeatToolRegistry.execute(
    "create_reminder",
    { fire_at: "明天早上九点", prompt: "自然语言时间" },
    CHAT_CTX,
  );

  assert.match(textOf(result), /无法解析时间/);
});

test("create_reminder enforces the per-account queue limit", async () => {
  const queued = Array.from({ length: MAX_PENDING_PER_ACCOUNT }, (_, i) =>
    makeReminder({
      accountId: "acc-1",
      conversationId: "conv-1",
      prompt: `已有 ${i}`,
      fireAt: new Date(Date.now() + 3600_000),
    }),
  );

  let created = false;
  setHeartbeatStore(
    createStore({
      async listByAccount() {
        return queued;
      },
      async createReminder(input) {
        created = true;
        return makeReminder(input);
      },
    }),
  );

  const result = await heartbeatToolRegistry.execute(
    "create_reminder",
    { fire_at: isoIn(3600_000), prompt: "再来一条" },
    CHAT_CTX,
  );

  assert.equal(created, false);
  assert.match(textOf(result), /上限/);
});

test("create_reminder is refused inside background runs", async () => {
  for (const runKind of ["heartbeat", "scheduler"] as const) {
    let created = false;
    setHeartbeatStore(
      createStore({
        async createReminder(input) {
          created = true;
          return makeReminder(input);
        },
      }),
    );

    const result = await heartbeatToolRegistry.execute(
      "create_reminder",
      { fire_at: isoIn(3600_000), prompt: "递归登记" },
      { ...CHAT_CTX, runKind },
    );

    assert.equal(created, false, `${runKind} must not create reminders`);
    assert.match(textOf(result), /拒绝/);
  }
});

test("list_reminders reports queued reminders", async () => {
  setHeartbeatStore(
    createStore({
      async listByAccount() {
        return [
          makeReminder({
            accountId: "acc-1",
            conversationId: "conv-1",
            prompt: "问问他面试结果",
            fireAt: new Date("2026-07-28T01:00:00.000Z"),
          }),
        ];
      },
    }),
  );

  const result = await heartbeatToolRegistry.execute("list_reminders", {}, CHAT_CTX);
  const text = textOf(result);

  assert.match(text, /待触发提醒 \(1\)/);
  assert.match(text, /问问他面试结果/);
});

test("list_reminders reports an empty queue", async () => {
  setHeartbeatStore(createStore());

  const result = await heartbeatToolRegistry.execute("list_reminders", {}, CHAT_CTX);
  assert.match(textOf(result), /没有待触发的提醒/);
});

test("cancel_reminder deletes the reminder", async () => {
  let claimed: string | undefined;
  setHeartbeatStore(
    createStore({
      async claimById(reminderId) {
        claimed = reminderId;
        return makeReminder({
          accountId: "acc-1",
          conversationId: "conv-1",
          prompt: "问问他面试结果",
          fireAt: new Date("2026-07-28T01:00:00.000Z"),
        });
      },
    }),
  );

  const result = await heartbeatToolRegistry.execute(
    "cancel_reminder",
    { reminder_id: "11111111-1111-1111-1111-111111111111" },
    CHAT_CTX,
  );

  assert.equal(claimed, "11111111-1111-1111-1111-111111111111");
  assert.match(textOf(result), /已取消提醒/);
});

test("cancel_reminder reports a miss instead of failing", async () => {
  setHeartbeatStore(createStore());

  const result = await heartbeatToolRegistry.execute(
    "cancel_reminder",
    { reminder_id: "22222222-2222-2222-2222-222222222222" },
    CHAT_CTX,
  );

  assert.match(textOf(result), /未找到/);
});
