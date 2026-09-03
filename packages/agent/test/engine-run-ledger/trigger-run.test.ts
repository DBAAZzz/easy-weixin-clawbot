import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentRunEvent,
  AgentRunStore,
  AppendAgentRunEventInput,
  AppendResult,
  ConversationEvent,
  ConversationEventStore,
  AppendConversationEventInput,
} from "../../src/index.js";
import {
  AGENT_RUN_EVENT_TYPE,
  CONVERSATION_EVENT_TYPE,
} from "../../src/shared/fact-ledger/contracts.js";
import { createRunLedgerRecorder } from "../../src/engine/run-ledger/recorder.js";
import { createTriggerRunId } from "../../src/engine/run-ledger/ids.js";
import { recordProactiveOutbound } from "../../src/capabilities/outbound-facts.js";

function fakeRunStore(): AgentRunStore & { appended: AppendAgentRunEventInput[] } {
  const appended: AppendAgentRunEventInput[] = [];
  return {
    appended,
    async append(input) {
      appended.push(input);
      return {
        value: {
          ...input,
          runSeq: appended.length,
          recordedAt: "2026-08-30T00:00:00.000Z",
        } as AgentRunEvent,
        appended: true,
      };
    },
    async getById() {
      return null;
    },
    async listRun() {
      return [];
    },
    async listRunEventsByStream() {
      return [];
    },
  } as AgentRunStore & { appended: AppendAgentRunEventInput[] };
}

function fakeConversationStore(): ConversationEventStore & {
  appended: AppendConversationEventInput[];
} {
  const appended: AppendConversationEventInput[] = [];
  return {
    appended,
    async append(input) {
      appended.push(input as AppendConversationEventInput);
      return {
        value: {
          ...input,
          streamSeq: appended.length,
          recordedAt: "2026-08-30T00:00:00.000Z",
        } as ConversationEvent,
        appended: true,
      };
    },
    async getById() {
      return null;
    },
    async listStream() {
      return [];
    },
    async getStreamHeadSeq() {
      return undefined;
    },
  } as ConversationEventStore & { appended: AppendConversationEventInput[] };
}

function makeTriggerRecorder(store: AgentRunStore) {
  return createRunLedgerRecorder({
    agentRunStore: store,
    accountId: "account-1",
    runId: createTriggerRunId("account-1", "heartbeat", "42", "2026-08-30T10:00:00.000Z"),
  });
}

const START = {
  conversationStreamId: "stream-1",
  occurredAt: "2026-08-30T10:00:00.000Z",
  anchorStreamSeq: 7,
};

test("trigger run_started omits triggerEventId + causationId and anchors the stream", async () => {
  const store = fakeRunStore();
  const recorder = makeTriggerRecorder(store);
  assert.equal(await recorder.start(START), true);
  await recorder.drain();

  assert.equal(store.appended.length, 1);
  const started = store.appended[0]!;
  assert.deepEqual(started.payload, { runKind: "chat", anchorStreamSeq: 7 });
  assert.equal(started.causationId, undefined, "trigger run_started has no ingress causation");
  assert.equal(started.correlationId, "stream-1", "correlation falls back to the execution stream");
});

test("trigger runs without an anchor omit anchorStreamSeq from the payload", async () => {
  const store = fakeRunStore();
  const recorder = makeTriggerRecorder(store);
  assert.equal(
    await recorder.start({ conversationStreamId: "stream-1", occurredAt: START.occurredAt }),
    true,
  );
  await recorder.drain();
  assert.deepEqual(store.appended[0]!.payload, { runKind: "chat" });
});

test("ingress runs keep their receipt-keyed envelope (unchanged Phase 4 shape)", async () => {
  const store = fakeRunStore();
  const recorder = createRunLedgerRecorder({
    agentRunStore: store,
    accountId: "account-1",
    runId: "run-1",
  });
  assert.equal(
    await recorder.start({ ...START, sourceEventId: "trigger-1", anchorStreamSeq: undefined }),
    true,
  );
  await recorder.drain();
  const started = store.appended[0]!;
  assert.deepEqual(started.payload, { runKind: "chat", triggerEventId: "trigger-1" });
  assert.equal(started.causationId, "trigger-1");
  assert.equal(started.correlationId, "trigger-1");
});

test("proactive push success appends delivery_succeeded + outbound fact on the right streams", async () => {
  const runStore = fakeRunStore();
  const conversationStore = fakeConversationStore();
  // delivery_requested 已由 turn 层写入。
  runStore.getById = async () => ({ eventId: "requested" } as AgentRunEvent);

  await recordProactiveOutbound(
    {
      accountId: "account-1",
      executionStreamId: "scheduler:1",
      targetConversationId: "wechat-conv-1",
      runId: "run-v1:abc",
      text: "提醒你啦",
      pushSucceeded: true,
    },
    { agentRunStore: runStore, conversationEventStore: conversationStore },
  );

  const runEvent = runStore.appended[0]!;
  assert.equal(runEvent.eventType, AGENT_RUN_EVENT_TYPE.DELIVERY_SUCCEEDED);
  assert.equal(runEvent.conversationStreamId, "scheduler:1", "run event stays on the execution stream");
  assert.equal(runEvent.correlationId, "run-v1:abc");

  const fact = conversationStore.appended[0]!;
  assert.equal(fact.eventType, CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERED);
  assert.equal(fact.streamId, "wechat-conv-1", "outbound fact lands in the TARGET conversation");
  assert.equal(fact.causationId, "run-v1:abc");
  assert.equal(fact.correlationId, "run-v1:abc");
  const payload = fact.payload as { text: string; deliveryId: string };
  assert.equal(payload.text, "提醒你啦");
  assert.ok(payload.deliveryId.startsWith("delivery-v1:"));
  assert.ok(fact.eventId.startsWith("outbound-v1:"));
});

test("proactive push failure appends delivery_failed + outbound failed fact", async () => {
  const runStore = fakeRunStore();
  const conversationStore = fakeConversationStore();
  runStore.getById = async () => ({ eventId: "requested" } as AgentRunEvent);

  await recordProactiveOutbound(
    {
      accountId: "account-1",
      executionStreamId: "conv-1",
      targetConversationId: "conv-1",
      runId: "run-v1:abc",
      text: "hello",
      pushSucceeded: false,
      failureReason: "context timeout",
    },
    { agentRunStore: runStore, conversationEventStore: conversationStore },
  );

  assert.equal(runStore.appended[0]!.eventType, AGENT_RUN_EVENT_TYPE.DELIVERY_FAILED);
  const fact = conversationStore.appended[0]!;
  assert.equal(fact.eventType, CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERY_FAILED);
  assert.deepEqual(fact.payload, {
    deliveryId: (fact.payload as { deliveryId: string }).deliveryId,
    channel: "weixin",
    reason: "context timeout",
    retryable: false,
  });
});

test("missing runId or a degraded run (no delivery_requested) skips the facts", async () => {
  const runStore = fakeRunStore();
  const conversationStore = fakeConversationStore();

  await recordProactiveOutbound(
    {
      accountId: "account-1",
      executionStreamId: "conv-1",
      targetConversationId: "conv-1",
      runId: undefined,
      text: "hello",
      pushSucceeded: true,
    },
    { agentRunStore: runStore, conversationEventStore: conversationStore },
  );
  // degraded run：delivery_requested 缺失。
  await recordProactiveOutbound(
    {
      accountId: "account-1",
      executionStreamId: "conv-1",
      targetConversationId: "conv-1",
      runId: "run-v1:abc",
      text: "hello",
      pushSucceeded: true,
    },
    { agentRunStore: runStore, conversationEventStore: conversationStore },
  );

  assert.deepEqual(runStore.appended, []);
  assert.deepEqual(conversationStore.appended, []);
});

test("fact write failure is fail-open: warn only, never throw", async () => {
  const failingRunStore = fakeRunStore();
  failingRunStore.append = async () => {
    throw new Error("db down");
  };
  failingRunStore.getById = async () => ({ eventId: "requested" } as AgentRunEvent);

  await recordProactiveOutbound(
    {
      accountId: "account-1",
      executionStreamId: "conv-1",
      targetConversationId: "conv-1",
      runId: "run-v1:abc",
      text: "hello",
      pushSucceeded: true,
    },
    { agentRunStore: failingRunStore, conversationEventStore: fakeConversationStore() },
  );
  assert.ok("no throw");
});

test("createTriggerRunId is deterministic and distinguishes inputs", () => {
  const a = createTriggerRunId("account-1", "heartbeat", "42", "2026-08-30T10:00:00.000Z");
  const b = createTriggerRunId("account-1", "heartbeat", "42", "2026-08-30T10:00:00.000Z");
  const c = createTriggerRunId("account-1", "heartbeat", "42", "2026-08-30T10:05:00.000Z");
  const d = createTriggerRunId("account-1", "scheduler", "42", "2026-08-30T10:00:00.000Z");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.ok(a.startsWith("run-v1:"));
});
