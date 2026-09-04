import {
  FactLedgerIdConflictError,
  FactLedgerSequenceOverflowError,
  parseAppendMemoryEventInput,
  type AppendMemoryEventInput,
  type AppendResult,
  type JsonValue,
  type ListMemoryEventsInput,
  type MemoryAssertionCategory,
  type MemoryEvent,
  type MemoryEventStore,
} from "@clawbot/agent";
import { Prisma, type PrismaClient } from "@prisma/client";
import { memoryEventFromRow, toPrismaJson } from "./fact-ledger/codec.js";
import { memoryEventMatchesRetry } from "./fact-ledger/equivalence.js";
import { isPrismaUniqueConstraintError } from "./fact-ledger/errors.js";
import { sequenceRange, validateSequencePage } from "./fact-ledger/pagination.js";
import { getPrisma } from "./prisma.js";

async function allocateMemorySeq(
  tx: Prisma.TransactionClient,
  accountId: string,
  branch: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ lastSeq: number }>>(Prisma.sql`
    INSERT INTO "memory_stream_heads" ("account_id", "branch", "last_seq", "updated_at")
    VALUES (${accountId}, ${branch}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("account_id", "branch") DO UPDATE
    SET "last_seq" = "memory_stream_heads"."last_seq" + 1,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "memory_stream_heads"."last_seq" < 2147483647
    RETURNING "last_seq" AS "lastSeq"
  `);
  const row = rows[0];
  if (!row) throw new FactLedgerSequenceOverflowError("memory", `${accountId}:${branch}`);
  return row.lastSeq;
}

export class PrismaMemoryEventStore implements MemoryEventStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async append(rawInput: AppendMemoryEventInput): Promise<AppendResult<MemoryEvent>> {
    const input = parseAppendMemoryEventInput(rawInput);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.memoryEvent.findUnique({ where: { eventId: input.eventId } });
        if (existing) return this.resolveRetry(memoryEventFromRow(existing), input);

        const memorySeq = await allocateMemorySeq(tx, input.accountId, input.branch);
        const row = await tx.memoryEvent.create({
          data: {
            eventId: input.eventId,
            accountId: input.accountId,
            branch: input.branch,
            memorySeq,
            eventType: input.eventType,
            schemaVersion: input.schemaVersion,
            occurredAt: new Date(input.occurredAt),
            actorKind: input.actor.kind,
            actorId: input.actor.id,
            causationId: input.causationId,
            correlationId: input.correlationId,
            payload: toPrismaJson(input.payload as JsonValue),
            // Phase 5 冗余列：仅 memory_asserted 行填充，服务 findLiveAssertionByKey
            category:
              input.eventType === "memory_asserted"
                ? (input.payload as { category: string }).category
                : null,
            key:
              input.eventType === "memory_asserted"
                ? (input.payload as { key: string }).key
                : null,
          },
        });
        return { value: memoryEventFromRow(row), appended: true };
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      const existing = await this.getById(input.eventId);
      if (existing) return this.resolveRetry(existing, input);
      throw new FactLedgerIdConflictError("memory_event", input.eventId);
    }
  }

  async getById(eventId: string): Promise<MemoryEvent | null> {
    const row = await this.prisma.memoryEvent.findUnique({ where: { eventId } });
    return row ? memoryEventFromRow(row) : null;
  }

  async listBranch(input: ListMemoryEventsInput): Promise<MemoryEvent[]> {
    validateSequencePage(input);
    const rows = await this.prisma.memoryEvent.findMany({
      where: {
        accountId: input.accountId,
        branch: input.branch,
        memorySeq: sequenceRange(input),
      },
      orderBy: { memorySeq: "asc" },
      take: input.limit,
    });
    return rows.map(memoryEventFromRow);
  }

  async headSeq(accountId: string, branch: string): Promise<number> {
    const head = await this.prisma.memoryStreamHead.findUnique({
      where: { accountId_branch: { accountId, branch } },
      select: { lastSeq: true },
    });
    return head?.lastSeq ?? 0;
  }

  async findLiveAssertionByKey(
    accountId: string,
    branch: string,
    category: MemoryAssertionCategory,
    key: string,
  ): Promise<MemoryEvent | null> {
    const row = await this.prisma.memoryEvent.findFirst({
      where: { accountId, branch, category, key },
      orderBy: { memorySeq: "desc" },
    });
    return row ? memoryEventFromRow(row) : null;
  }

  private resolveRetry(
    stored: MemoryEvent,
    input: AppendMemoryEventInput,
  ): AppendResult<MemoryEvent> {
    if (!memoryEventMatchesRetry(stored, input)) {
      throw new FactLedgerIdConflictError("memory_event", input.eventId);
    }
    return { value: stored, appended: false };
  }
}
