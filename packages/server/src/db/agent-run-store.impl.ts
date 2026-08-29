import {
  FactLedgerIdConflictError,
  FactLedgerSequenceOverflowError,
  parseAppendAgentRunEventInput,
  type AgentRunEvent,
  type AgentRunStore,
  type AppendAgentRunEventInput,
  type AppendResult,
  type JsonValue,
  type ListAgentRunEventsInput,
  type ListRunEventsByStreamInput,
} from "@clawbot/agent";
import { Prisma, type PrismaClient } from "@prisma/client";
import { agentRunEventFromRow, toPrismaJson } from "./fact-ledger/codec.js";
import { agentRunEventMatchesRetry } from "./fact-ledger/equivalence.js";
import { isPrismaUniqueConstraintError } from "./fact-ledger/errors.js";
import { sequenceRange, validateSequencePage } from "./fact-ledger/pagination.js";
import { getPrisma } from "./prisma.js";

async function allocateRunSeq(
  tx: Prisma.TransactionClient,
  input: AppendAgentRunEventInput,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ lastSeq: number }>>(Prisma.sql`
    INSERT INTO "agent_run_heads"
      ("run_id", "account_id", "conversation_stream_id", "last_seq", "updated_at")
    VALUES (${input.runId}, ${input.accountId}, ${input.conversationStreamId}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("run_id") DO UPDATE
    SET "last_seq" = "agent_run_heads"."last_seq" + 1,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "agent_run_heads"."last_seq" < 2147483647
      AND "agent_run_heads"."account_id" = EXCLUDED."account_id"
      AND "agent_run_heads"."conversation_stream_id" = EXCLUDED."conversation_stream_id"
    RETURNING "last_seq" AS "lastSeq"
  `);
  const row = rows[0];
  if (row) return row.lastSeq;

  const head = await tx.agentRunHead.findUnique({ where: { runId: input.runId } });
  if (
    head &&
    (head.accountId !== input.accountId || head.conversationStreamId !== input.conversationStreamId)
  ) {
    throw new FactLedgerIdConflictError("run_head", input.runId);
  }
  throw new FactLedgerSequenceOverflowError("run", input.runId);
}

export class PrismaAgentRunStore implements AgentRunStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async append(rawInput: AppendAgentRunEventInput): Promise<AppendResult<AgentRunEvent>> {
    const input = parseAppendAgentRunEventInput(rawInput);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const existing = await tx.agentRunEvent.findUnique({ where: { eventId: input.eventId } });
        if (existing) return this.resolveRetry(agentRunEventFromRow(existing), input);

        const runSeq = await allocateRunSeq(tx, input);
        const row = await tx.agentRunEvent.create({
          data: {
            eventId: input.eventId,
            runId: input.runId,
            runSeq,
            accountId: input.accountId,
            conversationStreamId: input.conversationStreamId,
            eventType: input.eventType,
            schemaVersion: input.schemaVersion,
            occurredAt: new Date(input.occurredAt),
            causationId: input.causationId,
            correlationId: input.correlationId,
            payload: toPrismaJson(input.payload as JsonValue),
          },
        });
        return { value: agentRunEventFromRow(row), appended: true };
      });
    } catch (error) {
      if (!isPrismaUniqueConstraintError(error)) throw error;
      const existing = await this.getById(input.eventId);
      if (existing) return this.resolveRetry(existing, input);
      throw new FactLedgerIdConflictError("agent_run_event", input.eventId);
    }
  }

  async getById(eventId: string): Promise<AgentRunEvent | null> {
    const row = await this.prisma.agentRunEvent.findUnique({ where: { eventId } });
    return row ? agentRunEventFromRow(row) : null;
  }

  async listRun(input: ListAgentRunEventsInput): Promise<AgentRunEvent[]> {
    validateSequencePage(input);
    const rows = await this.prisma.agentRunEvent.findMany({
      where: { runId: input.runId, runSeq: sequenceRange(input) },
      orderBy: { runSeq: "asc" },
      take: input.limit,
    });
    return rows.map(agentRunEventFromRow);
  }

  async listRunEventsByStream(input: ListRunEventsByStreamInput): Promise<AgentRunEvent[]> {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new Error("invalid_run_events_by_stream_limit");
    }
    const after = input.after
      ? {
          OR: [
            { recordedAt: { gt: new Date(input.after.recordedAt) } },
            {
              recordedAt: new Date(input.after.recordedAt),
              eventId: { gt: input.after.eventId },
            },
          ],
        }
      : undefined;
    const rows = await this.prisma.agentRunEvent.findMany({
      where: {
        accountId: input.accountId,
        conversationStreamId: input.conversationStreamId,
        ...(after ?? {}),
      },
      orderBy: [{ recordedAt: "asc" }, { eventId: "asc" }],
      take: input.limit,
    });
    return rows.map(agentRunEventFromRow);
  }

  private resolveRetry(
    stored: AgentRunEvent,
    input: AppendAgentRunEventInput,
  ): AppendResult<AgentRunEvent> {
    if (!agentRunEventMatchesRetry(stored, input)) {
      throw new FactLedgerIdConflictError("agent_run_event", input.eventId);
    }
    return { value: stored, appended: false };
  }
}
