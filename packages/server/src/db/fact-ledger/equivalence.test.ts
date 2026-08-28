import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_RUN_EVENT_TYPE,
  ARTIFACT_KIND,
  CONVERSATION_EVENT_TYPE,
  FACT_LEDGER_SCHEMA_VERSION,
  MEMORY_EVENT_TYPE,
  parseAgentRunEvent,
  parseAppendAgentRunEventInput,
  parseAppendConversationEventInput,
  parseAppendMemoryEventInput,
  parseArtifactRevision,
  parseConversationEvent,
  parseMemoryEvent,
  parsePutArtifactRevisionInput,
  sha256CanonicalJson,
} from "@clawbot/agent";
import {
  agentRunEventMatchesRetry,
  artifactMatchesIdRetry,
  conversationEventMatchesIdempotencyRetry,
  conversationEventMatchesIdRetry,
  memoryEventMatchesRetry,
} from "./equivalence.js";

const BASE = {
  eventId: "event-1",
  accountId: "account-1",
  streamId: "stream-1",
  eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
  schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
  occurredAt: "2026-08-28T00:00:00.000Z",
  receivedAt: "2026-08-28T00:00:00.100Z",
  actor: { kind: "user" as const, id: "user-1" },
  idempotencyKey: "fictional:message-1",
  payload: { channel: "fictional", text: "hello", attachmentRefs: [] },
};

const STORED = parseConversationEvent({
  ...BASE,
  streamSeq: 1,
  recordedAt: "2026-08-28T00:00:00.200Z",
});

test("event-id retries ignore receivedAt but retain business identity", () => {
  const retried = parseAppendConversationEventInput({
    ...BASE,
    occurredAt: "2026-08-28T08:00:00.000+08:00",
    receivedAt: "2026-08-28T00:01:00.000Z",
  });
  assert.equal(conversationEventMatchesIdRetry(STORED, retried), true);

  const changedKey = parseAppendConversationEventInput({
    ...retried,
    idempotencyKey: "fictional:message-2",
  });
  assert.equal(conversationEventMatchesIdRetry(STORED, changedKey), false);
});

test("platform-idempotency retries may change eventId and receivedAt, not payload", () => {
  const retried = parseAppendConversationEventInput({
    ...BASE,
    eventId: "event-2",
    receivedAt: "2026-08-28T00:01:00.000Z",
  });
  assert.equal(conversationEventMatchesIdempotencyRetry(STORED, retried), true);

  const changedPayload = parseAppendConversationEventInput({
    ...retried,
    payload: { ...retried.payload, text: "changed" },
  });
  assert.equal(conversationEventMatchesIdempotencyRetry(STORED, changedPayload), false);
});

test("run event-id retries ignore database fields but retain business identity", () => {
  const input = parseAppendAgentRunEventInput({
    eventId: "run-event-1",
    runId: "run-1",
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventType: AGENT_RUN_EVENT_TYPE.RUN_STARTED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt: "2026-08-28T00:00:00.000Z",
    payload: { runKind: "chat", triggerEventId: "event-1" },
  });
  const stored = parseAgentRunEvent({
    ...input,
    runSeq: 1,
    recordedAt: "2026-08-28T00:00:00.100Z",
  });
  const equivalent = parseAppendAgentRunEventInput({
    ...input,
    occurredAt: "2026-08-28T08:00:00.000+08:00",
  });
  const changed = parseAppendAgentRunEventInput({
    ...input,
    payload: { ...input.payload, triggerEventId: "event-2" },
  });

  assert.equal(agentRunEventMatchesRetry(stored, equivalent), true);
  assert.equal(agentRunEventMatchesRetry(stored, changed), false);
});

test("memory event-id retries ignore database fields but retain business identity", () => {
  const input = parseAppendMemoryEventInput({
    eventId: "memory-event-1",
    accountId: "account-1",
    branch: "main",
    eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt: "2026-08-28T00:00:00.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: {
      category: "preference",
      scope: "global",
      key: "drink",
      value: "tea",
      confidence: 1,
      sourceConversationEventIds: ["event-1"],
    },
  });
  const stored = parseMemoryEvent({
    ...input,
    memorySeq: 1,
    recordedAt: "2026-08-28T00:00:00.100Z",
  });
  const changed = parseAppendMemoryEventInput({
    ...input,
    payload: { ...input.payload, value: "coffee" },
  });

  assert.equal(memoryEventMatchesRetry(stored, input), true);
  assert.equal(memoryEventMatchesRetry(stored, changed), false);
});

test("artifact id retries ignore createdAt but retain content identity", () => {
  const input = parsePutArtifactRevisionInput({
    artifactId: "artifact-1",
    kind: ARTIFACT_KIND.SUMMARY,
    schemaVersion: 1,
    sha256: sha256CanonicalJson(null),
    inlineJson: null,
  });
  const stored = parseArtifactRevision({
    ...input,
    createdAt: "2026-08-28T00:00:00.100Z",
  });
  const changed = parsePutArtifactRevisionInput({
    ...input,
    sha256: "a".repeat(64),
  });

  assert.equal(artifactMatchesIdRetry(stored, input), true);
  assert.equal(artifactMatchesIdRetry(stored, changed), false);
});
