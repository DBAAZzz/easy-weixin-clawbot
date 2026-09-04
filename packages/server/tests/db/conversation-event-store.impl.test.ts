import assert from "node:assert/strict";
import test from "node:test";
import {
  CONVERSATION_EVENT_TYPE,
  FACT_LEDGER_SCHEMA_VERSION,
  FactLedgerIdConflictError,
} from "@clawbot/agent";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PrismaConversationEventStore } from "../../src/db/conversation-event-store.impl.js";

const input = {
  eventId: "event-1",
  accountId: "account-1",
  streamId: "stream-1",
  eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
  schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
  occurredAt: "2026-08-28T00:00:00.000Z",
  receivedAt: "2026-08-28T00:00:00.100Z",
  actor: { kind: "user" as const, id: "user-1" },
  idempotencyKey: "fictional:1",
  payload: { channel: "fictional", text: "hello", attachmentRefs: [] },
};

test("unexpected Prisma unique errors are converted to a domain conflict", async () => {
  const prismaError = new Prisma.PrismaClientKnownRequestError("unexpected unique conflict", {
    code: "P2002",
    clientVersion: Prisma.prismaVersion.client,
  });
  const eventDelegate = {
    findUnique: async () => null,
    findFirst: async () => null,
    create: async () => {
      throw prismaError;
    },
  };
  const transactionClient = {
    conversationEvent: eventDelegate,
    $queryRaw: async () => [{ lastSeq: 1 }],
  };
  const prisma = {
    conversationEvent: eventDelegate,
    $transaction: async (operation: (tx: typeof transactionClient) => unknown) =>
      operation(transactionClient),
  } as unknown as PrismaClient;
  const store = new PrismaConversationEventStore(prisma);

  await assert.rejects(() => store.append(input), FactLedgerIdConflictError);
});
