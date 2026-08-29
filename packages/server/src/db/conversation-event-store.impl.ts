import {
  FactLedgerIdConflictError,
  FactLedgerIdempotencyConflictError,
  FactLedgerSequenceOverflowError,
  parseAppendConversationEventInput,
  type AppendConversationEventInput,
  type AppendResult,
  type ConversationEvent,
  type ConversationEventStore,
  type JsonValue,
  type ListConversationEventsInput,
} from "@clawbot/agent";
import { Prisma, type PrismaClient } from "@prisma/client";
import { conversationEventFromRow, toPrismaJson } from "./fact-ledger/codec.js";
import {
  conversationEventMatchesIdempotencyRetry,
  conversationEventMatchesIdRetry,
} from "./fact-ledger/equivalence.js";
import { isPrismaUniqueConstraintError } from "./fact-ledger/errors.js";
import { sequenceRange, validateSequencePage } from "./fact-ledger/pagination.js";
import { getPrisma } from "./prisma.js";

export async function allocateConversationSeq(
  tx: Prisma.TransactionClient,
  accountId: string,
  streamId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ lastSeq: number }>>(Prisma.sql`
    INSERT INTO "conversation_stream_heads" ("account_id", "stream_id", "last_seq", "updated_at")
    VALUES (${accountId}, ${streamId}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("account_id", "stream_id") DO UPDATE
    SET "last_seq" = "conversation_stream_heads"."last_seq" + 1,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "conversation_stream_heads"."last_seq" < 2147483647
    RETURNING "last_seq" AS "lastSeq"
  `);
  const row = rows[0];
  if (!row) throw new FactLedgerSequenceOverflowError("conversation", `${accountId}:${streamId}`);
  return row.lastSeq;
}

function resolveIdRetry(
  stored: ConversationEvent,
  input: AppendConversationEventInput,
): AppendResult<ConversationEvent> {
  if (!conversationEventMatchesIdRetry(stored, input)) {
    throw new FactLedgerIdConflictError("conversation_event", input.eventId);
  }
  return { value: stored, appended: false };
}

function resolveIdempotencyRetry(
  stored: ConversationEvent,
  input: AppendConversationEventInput,
): AppendResult<ConversationEvent> {
  if (!conversationEventMatchesIdempotencyRetry(stored, input)) {
    throw new FactLedgerIdempotencyConflictError(input.accountId, input.idempotencyKey!);
  }
  return { value: stored, appended: false };
}

/** Internal transaction-aware append core. Callers own retries and commit boundaries. */
export async function appendConversationEventInTransaction(
  tx: Prisma.TransactionClient,
  rawInput: AppendConversationEventInput,
): Promise<AppendResult<ConversationEvent>> {
  const input = parseAppendConversationEventInput(rawInput);
  const existingById = await tx.conversationEvent.findUnique({ where: { eventId: input.eventId } });
  if (existingById) return resolveIdRetry(conversationEventFromRow(existingById), input);

  if (input.idempotencyKey) {
    const existingByKey = await tx.conversationEvent.findFirst({
      where: { accountId: input.accountId, idempotencyKey: input.idempotencyKey },
    });
    if (existingByKey)
      return resolveIdempotencyRetry(conversationEventFromRow(existingByKey), input);
  }

  const streamSeq = await allocateConversationSeq(tx, input.accountId, input.streamId);
  const row = await tx.conversationEvent.create({
    data: {
      eventId: input.eventId,
      accountId: input.accountId,
      streamId: input.streamId,
      streamSeq,
      eventType: input.eventType,
      schemaVersion: input.schemaVersion,
      occurredAt: new Date(input.occurredAt),
      receivedAt: new Date(input.receivedAt),
      actorKind: input.actor.kind,
      actorId: input.actor.id,
      causationId: input.causationId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      payload: toPrismaJson(input.payload as JsonValue),
    },
  });
  return { value: conversationEventFromRow(row), appended: true };
}

export class PrismaConversationEventStore implements ConversationEventStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async append(rawInput: AppendConversationEventInput): Promise<AppendResult<ConversationEvent>> {
    const input = parseAppendConversationEventInput(rawInput);

    try {
      return await this.prisma.$transaction(async (tx) => {
        return appendConversationEventInTransaction(tx, input);
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      return this.resolveConcurrentDuplicate(input);
    }
  }

  async getById(eventId: string): Promise<ConversationEvent | null> {
    const row = await this.prisma.conversationEvent.findUnique({ where: { eventId } });
    return row ? conversationEventFromRow(row) : null;
  }

  async listStream(input: ListConversationEventsInput): Promise<ConversationEvent[]> {
    validateSequencePage(input);
    const rows = await this.prisma.conversationEvent.findMany({
      where: {
        accountId: input.accountId,
        streamId: input.streamId,
        streamSeq: sequenceRange(input),
      },
      orderBy: { streamSeq: "asc" },
      take: input.limit,
    });
    return rows.map(conversationEventFromRow);
  }

  private resolveIdRetry(
    stored: ConversationEvent,
    input: AppendConversationEventInput,
  ): AppendResult<ConversationEvent> {
    return resolveIdRetry(stored, input);
  }

  private resolveIdempotencyRetry(
    stored: ConversationEvent,
    input: AppendConversationEventInput,
  ): AppendResult<ConversationEvent> {
    return resolveIdempotencyRetry(stored, input);
  }

  private async resolveConcurrentDuplicate(
    input: AppendConversationEventInput,
  ): Promise<AppendResult<ConversationEvent>> {
    const existingById = await this.getById(input.eventId);
    if (existingById) return this.resolveIdRetry(existingById, input);

    if (input.idempotencyKey) {
      const row = await this.prisma.conversationEvent.findFirst({
        where: { accountId: input.accountId, idempotencyKey: input.idempotencyKey },
      });
      if (row) return this.resolveIdempotencyRetry(conversationEventFromRow(row), input);
    }

    throw new FactLedgerIdConflictError("conversation_event", input.eventId);
  }
}
