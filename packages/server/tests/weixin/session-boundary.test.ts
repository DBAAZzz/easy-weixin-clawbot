import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationEvent } from "@clawbot/agent";
import { buildSessionBoundaryEvent, createSessionBoundaryEventId } from "../../src/weixin/session-boundary.js";

const source: ConversationEvent = {
  eventId: "source-event-1",
  accountId: "account-1",
  streamId: "user-1",
  streamSeq: 9,
  eventType: "inbound_message_received",
  schemaVersion: 1,
  occurredAt: "2026-08-28T00:00:00.000Z",
  receivedAt: "2026-08-28T00:00:01.000Z",
  recordedAt: "2026-08-28T00:00:02.000Z",
  actor: { kind: "user", id: "user-1" },
  payload: {
    channel: "weixin",
    text: "/clear",
    attachmentRefs: [],
  },
};

test("session boundary identity and time are deterministic from the source fact", () => {
  const first = buildSessionBoundaryEvent(source);
  const second = buildSessionBoundaryEvent(structuredClone(source));
  assert.deepEqual(first, second);
  assert.equal(first.eventId, createSessionBoundaryEventId("account-1", "source-event-1"));
  assert.match(first.eventId, /^session-boundary-v1:[a-f0-9]{64}$/u);
  assert.equal(first.idempotencyKey, "session-boundary:v1:source-event-1");
  assert.equal(first.occurredAt, source.occurredAt);
  assert.equal(first.receivedAt, source.receivedAt);
  assert.equal(first.causationId, source.eventId);
  assert.equal(first.correlationId, source.eventId);
  assert.deepEqual(first.payload, { previousStreamId: "user-1", reason: "user_clear" });
});

test("account identity is part of the deterministic boundary id", () => {
  assert.notEqual(
    createSessionBoundaryEventId("account-1", "same-source"),
    createSessionBoundaryEventId("account-2", "same-source"),
  );
});
