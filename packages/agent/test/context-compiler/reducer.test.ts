import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_EVENT_TYPE,
  type ConversationEvent,
} from "../../src/shared/fact-ledger/contracts.js";
import { reduceConversationEvents } from "../../src/context-compiler/conversation-reducer.js";

function envelope(eventId: string, streamSeq: number) {
  return {
    eventId,
    accountId: "account-1",
    streamId: "stream-1",
    streamSeq,
    schemaVersion: 1 as const,
    occurredAt: "2026-08-28T01:00:00.000Z",
    receivedAt: "2026-08-28T01:00:01.000Z",
    recordedAt: "2026-08-28T01:00:02.000Z",
    actor: { kind: "user" as const, id: "user-1" },
  };
}

function inbound(
  eventId: string,
  streamSeq: number,
  text: string,
  attachmentRefs: string[] = [],
): ConversationEvent {
  return {
    ...envelope(eventId, streamSeq),
    eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
    payload: { channel: "weixin", text, attachmentRefs },
  };
}

function sessionRotated(eventId: string, streamSeq: number): ConversationEvent {
  return {
    ...envelope(eventId, streamSeq),
    eventType: CONVERSATION_EVENT_TYPE.SESSION_ROTATED,
    payload: { previousStreamId: "stream-1", reason: "user_clear" },
  };
}

test("reducer maps outbound delivered facts to assistant entries", () => {
  const reduced = reduceConversationEvents(
    [
      inbound("one", 1, "hi"),
      {
        ...envelope("out", 2),
        eventType: CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERED,
        payload: { deliveryId: "delivery-1", channel: "weixin", text: "reply", attachmentRefs: [] },
      },
    ],
    2,
  );
  assert.deepEqual(
    reduced.entries.map((entry) => [entry.role, entry.text]),
    [
      ["user", "hi"],
      ["assistant", "reply"],
    ],
  );
});

test("reducer keeps reaction and non-message events out of entries", () => {
  const reduced = reduceConversationEvents(
    [
      inbound("one", 1, "hi"),
      {
        ...envelope("reaction", 2),
        eventType: CONVERSATION_EVENT_TYPE.REACTION_RECEIVED,
        payload: { targetEventId: "one", reaction: "👍" },
      },
    ],
    2,
  );
  assert.deepEqual(
    reduced.entries.map((entry) => entry.eventId),
    ["one"],
  );
  assert.deepEqual(reduced.diagnostics, []);
});

test("reducer fails closed on invalid cursors", () => {
  const events = [inbound("one", 1, "hi")];
  assert.throws(() => reduceConversationEvents(events, 0), /invalid_event_cursor/);
  assert.throws(() => reduceConversationEvents(events, 1.5), /invalid_event_cursor/);
});

test("reducer fails closed when the page ends before the cursor", () => {
  assert.throws(
    () => reduceConversationEvents([inbound("one", 1, "hi")], 2),
    /event_cursor_not_found/,
  );
  assert.throws(() => reduceConversationEvents([], 1), /event_cursor_not_found/);
});

test("reducer fails closed on future events and broken sequences", () => {
  const gap = [inbound("one", 1, "a"), inbound("three", 3, "c")];
  assert.throws(() => reduceConversationEvents(gap, 3), /invalid_event_sequence/);
  const duplicate = [inbound("one", 1, "a"), inbound("one-again", 1, "a2")];
  assert.throws(() => reduceConversationEvents(duplicate, 1), /invalid_event_sequence/);
  const future = [inbound("one", 1, "a"), inbound("two", 2, "b")];
  assert.throws(() => reduceConversationEvents(future, 1), /future_event_in_page/);
});

test("reducer fails closed on unsupported schema versions", () => {
  const events = [
    {
      ...inbound("one", 1, "hi"),
      schemaVersion: 2 as never,
    },
  ];
  assert.throws(() => reduceConversationEvents(events, 1), /unsupported_schema_version/);
});

test("dangling edit and cross-boundary edit produce diagnostics without guessing", () => {
  const events: ConversationEvent[] = [
    inbound("before", 1, "before"),
    sessionRotated("boundary", 2),
    inbound("current", 3, "current"),
    {
      ...envelope("edit-missing", 4),
      eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_EDITED,
      payload: { targetEventId: "nope", text: "x", attachmentRefs: [] },
    },
    {
      ...envelope("edit-cross-boundary", 5),
      eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_EDITED,
      payload: { targetEventId: "before", text: "x", attachmentRefs: [] },
    },
  ];
  const reduced = reduceConversationEvents(events, 5);
  assert.deepEqual(
    reduced.entries.map((entry) => [entry.eventId, entry.text]),
    [["current", "current"]],
  );
  assert.deepEqual(
    reduced.diagnostics.map((diagnostic) => diagnostic.code),
    ["dangling_edit_target", "dangling_edit_target"],
  );
  // Diagnostics never carry message bodies.
  assert.doesNotMatch(JSON.stringify(reduced.diagnostics), /before|x"/);
});

test("the latest boundary wins and boundary events never become entries", () => {
  const events: ConversationEvent[] = [
    inbound("a", 1, "a"),
    sessionRotated("boundary-1", 2),
    inbound("b", 3, "b"),
    sessionRotated("boundary-2", 4),
    inbound("c", 5, "c"),
  ];
  const reduced = reduceConversationEvents(events, 5);
  assert.equal(reduced.sessionBoundaryEventId, "boundary-2");
  assert.deepEqual(
    reduced.entries.map((entry) => entry.eventId),
    ["c"],
  );
});
