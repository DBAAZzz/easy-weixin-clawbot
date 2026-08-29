import { createHash } from "node:crypto";
import {
  parseAppendConversationEventInput,
  type AppendConversationEventInput,
  type ConversationEvent,
} from "@clawbot/agent";

export function createSessionBoundaryEventId(accountId: string, sourceEventId: string): string {
  const digest = createHash("sha256")
    .update(accountId, "utf8")
    .update("\0", "utf8")
    .update(sourceEventId, "utf8")
    .digest("hex");
  return `session-boundary-v1:${digest}`;
}

export function buildSessionBoundaryEvent(source: ConversationEvent): AppendConversationEventInput {
  return parseAppendConversationEventInput({
    eventId: createSessionBoundaryEventId(source.accountId, source.eventId),
    eventType: "session_rotated",
    schemaVersion: 1,
    accountId: source.accountId,
    streamId: source.streamId,
    occurredAt: source.occurredAt,
    receivedAt: source.receivedAt,
    actor: source.actor,
    causationId: source.eventId,
    correlationId: source.eventId,
    idempotencyKey: `session-boundary:v1:${source.eventId}`,
    payload: {
      // Compatibility-only history marker. The compiler applies this event's
      // streamSeq and never follows previousStreamId as a route.
      previousStreamId: source.streamId,
      reason: "user_clear",
    },
  });
}
