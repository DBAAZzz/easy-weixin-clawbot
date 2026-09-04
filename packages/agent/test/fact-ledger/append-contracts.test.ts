import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_RUN_EVENT_TYPE,
  ARTIFACT_KIND,
  CONVERSATION_EVENT_TYPE,
  FACT_LEDGER_SCHEMA_VERSION,
  MEMORY_EVENT_TYPE,
  UnsupportedFactLedgerSchemaVersionError,
  parseAppendAgentRunEventInput,
  parseAppendConversationEventInput,
  parseAppendMemoryEventInput,
  parsePutArtifactRevisionInput,
} from "../../src/shared/fact-ledger/index.js";

const TIME = "2026-08-28T00:00:00.000Z";

const conversationInput = {
  eventId: "event-1",
  accountId: "account-1",
  streamId: "stream-1",
  eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
  schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
  occurredAt: TIME,
  receivedAt: TIME,
  actor: { kind: "user" as const, id: "user-1" },
  payload: {
    channel: "fictional",
    text: "hello",
    attachmentRefs: [],
  },
};

const runInput = {
  eventId: "run-event-1",
  runId: "run-1",
  accountId: "account-1",
  conversationStreamId: "stream-1",
  eventType: AGENT_RUN_EVENT_TYPE.RUN_STARTED,
  schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
  occurredAt: TIME,
  payload: { runKind: "chat" as const, triggerEventId: "event-1" },
};

const memoryInput = {
  eventId: "memory-event-1",
  accountId: "account-1",
  branch: "stream-1",
  eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
  schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
  occurredAt: TIME,
  actor: { kind: "user" as const, id: "user-1" },
  payload: {
    category: "preference" as const,
    scope: "global" as const,
    key: "drink",
    value: { name: "tea", temperatures: ["hot", null] },
    confidence: 1,
    sourceConversationEventIds: ["event-1"],
  },
};

test("append inputs omit store-assigned sequence and recorded time", () => {
  assert.doesNotThrow(() => parseAppendConversationEventInput(conversationInput));
  assert.doesNotThrow(() => parseAppendAgentRunEventInput(runInput));
  assert.doesNotThrow(() => parseAppendMemoryEventInput(memoryInput));

  assert.throws(() => parseAppendConversationEventInput({ ...conversationInput, streamSeq: 1 }));
  assert.throws(() => parseAppendAgentRunEventInput({ ...runInput, recordedAt: TIME }));
  assert.throws(() => parseAppendMemoryEventInput({ ...memoryInput, memorySeq: 1 }));
});

test("append inputs preserve explicit unknown-version failures", () => {
  assert.throws(
    () => parseAppendConversationEventInput({ ...conversationInput, schemaVersion: 2 }),
    UnsupportedFactLedgerSchemaVersionError,
  );
});

test("all persisted open values must be JSON serializable", () => {
  assert.throws(() =>
    parseAppendMemoryEventInput({
      ...memoryInput,
      payload: { ...memoryInput.payload, value: { invalid: undefined } },
    }),
  );

  assert.throws(() =>
    parsePutArtifactRevisionInput({
      artifactId: "artifact-invalid",
      kind: ARTIFACT_KIND.SUMMARY,
      sha256: "a".repeat(64),
      schemaVersion: 1,
      inlineJson: { invalid: BigInt(1) },
    }),
  );
  assert.throws(() =>
    parsePutArtifactRevisionInput({
      artifactId: "artifact-date",
      kind: ARTIFACT_KIND.SUMMARY,
      sha256: "a".repeat(64),
      schemaVersion: 1,
      inlineJson: new Date(),
    }),
  );

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() =>
    parsePutArtifactRevisionInput({
      artifactId: "artifact-cycle",
      kind: ARTIFACT_KIND.SUMMARY,
      sha256: "a".repeat(64),
      schemaVersion: 1,
      inlineJson: cyclic,
    }),
  );
});

test("parsed JSON values are detached from caller-owned mutable objects", () => {
  const value = { nested: { drink: "tea" } };
  const parsed = parseAppendMemoryEventInput({
    ...memoryInput,
    payload: { ...memoryInput.payload, value },
  });
  value.nested.drink = "coffee";

  if (parsed.eventType !== MEMORY_EVENT_TYPE.MEMORY_ASSERTED) assert.fail("unexpected event");
  assert.deepEqual(parsed.payload.value, { nested: { drink: "tea" } });
});

test("an inline JSON null is distinct from an omitted artifact body", () => {
  assert.doesNotThrow(() =>
    parsePutArtifactRevisionInput({
      artifactId: "artifact-null",
      kind: ARTIFACT_KIND.SUMMARY,
      sha256: "a".repeat(64),
      schemaVersion: 1,
      inlineJson: null,
    }),
  );
});
