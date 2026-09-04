import {
  FactLedgerCorruptionError,
  UnsupportedFactLedgerSchemaVersionError,
  parseAgentRunEvent,
  parseArtifactRevision,
  parseConversationEvent,
  parseMemoryEvent,
  type AgentRunEvent,
  type ArtifactRevision,
  type ConversationEvent,
  type JsonValue,
  type MemoryEvent,
} from "@clawbot/agent";
import {
  Prisma,
  type AgentRunEvent as PrismaAgentRunEvent,
  type ArtifactRevision as PrismaArtifactRevision,
  type ConversationEvent as PrismaConversationEvent,
  type MemoryEvent as PrismaMemoryEvent,
} from "@prisma/client";

function parseStored<T>(
  entityKind: "conversation_event" | "agent_run_event" | "memory_event" | "artifact",
  entityId: string,
  parse: (input: unknown) => T,
  input: unknown,
): T {
  try {
    return parse(input);
  } catch (error) {
    if (error instanceof UnsupportedFactLedgerSchemaVersionError) throw error;
    throw new FactLedgerCorruptionError(entityKind, entityId, { cause: error });
  }
}

export function conversationEventFromRow(row: PrismaConversationEvent): ConversationEvent {
  return parseStored("conversation_event", row.eventId, parseConversationEvent, {
    eventId: row.eventId,
    accountId: row.accountId,
    streamId: row.streamId,
    streamSeq: row.streamSeq,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actor: { kind: row.actorKind, id: row.actorId ?? undefined },
    causationId: row.causationId ?? undefined,
    correlationId: row.correlationId ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    payload: row.payload,
  });
}

export function agentRunEventFromRow(row: PrismaAgentRunEvent): AgentRunEvent {
  return parseStored("agent_run_event", row.eventId, parseAgentRunEvent, {
    eventId: row.eventId,
    runId: row.runId,
    runSeq: row.runSeq,
    accountId: row.accountId,
    conversationStreamId: row.conversationStreamId,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    causationId: row.causationId ?? undefined,
    correlationId: row.correlationId ?? undefined,
    payload: row.payload,
  });
}

export function memoryEventFromRow(row: PrismaMemoryEvent): MemoryEvent {
  return parseStored("memory_event", row.eventId, parseMemoryEvent, {
    eventId: row.eventId,
    accountId: row.accountId,
    branch: row.branch,
    memorySeq: row.memorySeq,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
    actor: { kind: row.actorKind, id: row.actorId ?? undefined },
    causationId: row.causationId ?? undefined,
    correlationId: row.correlationId ?? undefined,
    payload: row.payload,
  });
}

export function artifactRevisionFromRow(row: PrismaArtifactRevision): ArtifactRevision {
  const content =
    row.contentLocation === "inline"
      ? { inlineJson: row.inlineJson }
      : row.contentLocation === "external"
        ? { storageRef: row.storageRef }
        : {};

  return parseStored("artifact", row.artifactId, parseArtifactRevision, {
    artifactId: row.artifactId,
    kind: row.kind,
    sha256: row.sha256,
    schemaVersion: row.schemaVersion,
    ...content,
    createdAt: row.createdAt.toISOString(),
    encryptionMetadata: row.encryptionMetadata ?? undefined,
  });
}

export function toPrismaJson(value: JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function toNullablePrismaJson(
  value: JsonValue | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === undefined) return Prisma.DbNull;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}
