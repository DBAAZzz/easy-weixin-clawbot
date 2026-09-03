import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_EVENT_TYPE,
  FACT_LEDGER_SCHEMA_VERSION,
  FactLedgerCorruptionError,
  UnsupportedFactLedgerSchemaVersionError,
} from "@clawbot/agent";
import type {
  ArtifactRevision as PrismaArtifactRevision,
  ConversationEvent as PrismaConversationEvent,
} from "@prisma/client";
import { artifactRevisionFromRow, conversationEventFromRow } from "../../../src/db/fact-ledger/codec.js";

const NOW = new Date("2026-08-28T00:00:00.000Z");

function conversationRow(): PrismaConversationEvent {
  return {
    eventId: "event-1",
    accountId: "account-1",
    streamId: "stream-1",
    streamSeq: 1,
    eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt: NOW,
    receivedAt: NOW,
    recordedAt: NOW,
    actorKind: "user",
    actorId: "user-1",
    causationId: null,
    correlationId: null,
    idempotencyKey: null,
    payload: { channel: "fictional", text: "hello", attachmentRefs: [] },
  };
}

test("conversation codec maps database timestamps and nullable fields", () => {
  const event = conversationEventFromRow(conversationRow());
  assert.equal(event.recordedAt, NOW.toISOString());
  assert.equal(event.actor.id, "user-1");
  assert.equal(event.causationId, undefined);
});

test("codec preserves unknown-version errors and wraps current-version corruption", () => {
  assert.throws(
    () => conversationEventFromRow({ ...conversationRow(), schemaVersion: 2 }),
    UnsupportedFactLedgerSchemaVersionError,
  );
  assert.throws(
    () => conversationEventFromRow({ ...conversationRow(), eventType: "not-a-current-event" }),
    FactLedgerCorruptionError,
  );
});

test("artifact content location preserves an inline JSON null", () => {
  const row: PrismaArtifactRevision = {
    artifactId: "artifact-null",
    kind: "summary",
    sha256: "a".repeat(64),
    schemaVersion: 1,
    contentLocation: "inline",
    inlineJson: null,
    storageRef: null,
    encryptionMetadata: null,
    createdAt: NOW,
  };

  const artifact = artifactRevisionFromRow(row);
  assert.equal(artifact.inlineJson, null);
  assert.equal(artifact.storageRef, undefined);
});
