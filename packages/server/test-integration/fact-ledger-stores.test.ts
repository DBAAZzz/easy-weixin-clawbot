import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  AGENT_RUN_EVENT_TYPE,
  ARTIFACT_KIND,
  CONVERSATION_EVENT_TYPE,
  FACT_LEDGER_SCHEMA_VERSION,
  MEMORY_EVENT_TYPE,
  FactLedgerIdConflictError,
  FactLedgerIdempotencyConflictError,
  sha256CanonicalJson,
} from "@clawbot/agent";
import { PrismaClient } from "@prisma/client";
import { PrismaAgentRunStore } from "../src/db/agent-run-store.impl.js";
import { PrismaArtifactRevisionStore } from "../src/db/artifact-revision-store.impl.js";
import { PrismaConversationEventStore } from "../src/db/conversation-event-store.impl.js";
import { PrismaMemoryEventStore } from "../src/db/memory-event-store.impl.js";

const databaseUrl = process.env.FACT_LEDGER_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("FACT_LEDGER_TEST_DATABASE_URL is required");

const databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1);
if (!databaseName?.endsWith("_fact_ledger_test")) {
  throw new Error("Fact ledger integration tests require a database ending in _fact_ledger_test");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const conversationStore = new PrismaConversationEventStore(prisma);
const runStore = new PrismaAgentRunStore(prisma);
const memoryStore = new PrismaMemoryEventStore(prisma);
const artifactStore = new PrismaArtifactRevisionStore(prisma);
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `fact-ledger-test-${nonce}`;
const occurredAt = "2026-08-28T00:00:00.000Z";

after(async () => {
  await prisma.$disconnect();
});

function conversationInput(index: number, streamId = `stream-${nonce}`) {
  return {
    eventId: `conversation-event-${nonce}-${index}`,
    accountId,
    streamId,
    eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt,
    receivedAt: new Date(Date.now() + index).toISOString(),
    actor: { kind: "user" as const, id: `user-${nonce}` },
    idempotencyKey: `fictional:${nonce}:${index}`,
    payload: { channel: "fictional", text: `message ${index}`, attachmentRefs: [] },
  };
}

test("fact ledger stores enforce transactional append invariants", async (t) => {
  await prisma.account.create({ data: { id: accountId } });

  await t.test("conversation append is concurrent, contiguous, and paginated", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) => conversationStore.append(conversationInput(index))),
    );
    assert.deepEqual(
      results.map((result) => result.value.streamSeq).sort((a, b) => a - b),
      Array.from({ length: 50 }, (_, index) => index + 1),
    );

    const page = await conversationStore.listStream({
      accountId,
      streamId: `stream-${nonce}`,
      afterSeq: 10,
      throughSeq: 15,
      limit: 50,
    });
    assert.deepEqual(
      page.map((event) => event.streamSeq),
      [11, 12, 13, 14, 15],
    );
  });

  await t.test("concurrent retries of one platform key create one fact", async () => {
    const sameInput = conversationInput(75);
    const [first, second] = await Promise.all([
      conversationStore.append(sameInput),
      conversationStore.append({ ...sameInput, eventId: `${sameInput.eventId}-retry` }),
    ]);
    assert.deepEqual([first.appended, second.appended].sort(), [false, true]);
    assert.equal(
      await prisma.conversationEvent.count({
        where: { accountId, idempotencyKey: sameInput.idempotencyKey },
      }),
      1,
    );

    const next = await conversationStore.append(conversationInput(76));
    assert.equal(next.value.streamSeq, first.value.streamSeq + 1);
  });

  await t.test("event id and platform key retries do not consume sequence", async () => {
    const original = conversationInput(100);
    const first = await conversationStore.append(original);
    const byId = await conversationStore.append({
      ...original,
      receivedAt: "2026-08-28T00:05:00.000Z",
    });
    const byKey = await conversationStore.append({
      ...original,
      eventId: `${original.eventId}-retry`,
      receivedAt: "2026-08-28T00:06:00.000Z",
    });
    assert.equal(first.appended, true);
    assert.equal(byId.appended, false);
    assert.equal(byKey.appended, false);
    assert.equal(byKey.value.eventId, original.eventId);

    await assert.rejects(
      () =>
        conversationStore.append({
          ...original,
          eventId: `${original.eventId}-conflict`,
          payload: { ...original.payload, text: "different" },
        }),
      FactLedgerIdempotencyConflictError,
    );

    const next = await conversationStore.append(conversationInput(101));
    assert.equal(next.value.streamSeq, first.value.streamSeq + 1);
  });

  await t.test("run head rejects identity rebinding without consuming sequence", async () => {
    const runId = `run-${nonce}`;
    const first = await runStore.append({
      eventId: `run-event-${nonce}-1`,
      runId,
      accountId,
      conversationStreamId: `stream-${nonce}`,
      eventType: AGENT_RUN_EVENT_TYPE.RUN_STARTED,
      schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
      occurredAt,
      payload: { runKind: "chat", triggerEventId: `conversation-event-${nonce}-0` },
    });
    assert.equal(first.value.runSeq, 1);

    await assert.rejects(
      () =>
        runStore.append({
          eventId: `run-event-${nonce}-wrong-stream`,
          runId,
          accountId,
          conversationStreamId: `other-stream-${nonce}`,
          eventType: AGENT_RUN_EVENT_TYPE.RUN_COMPLETED,
          schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
          occurredAt,
          payload: { rounds: 1 },
        }),
      FactLedgerIdConflictError,
    );

    const second = await runStore.append({
      eventId: `run-event-${nonce}-2`,
      runId,
      accountId,
      conversationStreamId: `stream-${nonce}`,
      eventType: AGENT_RUN_EVENT_TYPE.RUN_COMPLETED,
      schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
      occurredAt,
      payload: { rounds: 1 },
    });
    assert.equal(second.value.runSeq, 2);

    const orderedPage = await runStore.listRun({
      runId,
      afterSeq: 0,
      throughSeq: 2,
      limit: 10,
    });
    assert.deepEqual(
      orderedPage.map((event) => event.runSeq),
      [1, 2],
    );
    const exclusivePage = await runStore.listRun({
      runId,
      afterSeq: 1,
      throughSeq: 2,
      limit: 10,
    });
    assert.deepEqual(
      exclusivePage.map((event) => event.runSeq),
      [2],
    );
  });

  await t.test("memory branches allocate independent authoritative sequences", async () => {
    const append = (branch: string, index: number) =>
      memoryStore.append({
        eventId: `memory-${nonce}-${branch}-${index}`,
        accountId,
        branch,
        eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
        schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
        occurredAt,
        actor: { kind: "user", id: `user-${nonce}` },
        payload: {
          category: "preference",
          scope: "global",
          key: `key-${index}`,
          value: `value-${index}`,
          confidence: 1,
          sourceConversationEventIds: [`conversation-event-${nonce}-0`],
        },
      });

    const [a1, a2, b1] = await Promise.all([append("a", 1), append("a", 2), append("b", 1)]);
    assert.deepEqual(
      [a1.value.memorySeq, a2.value.memorySeq].sort((a, b) => a - b),
      [1, 2],
    );
    assert.equal(b1.value.memorySeq, 1);

    const orderedPage = await memoryStore.listBranch({
      accountId,
      branch: "a",
      afterSeq: 0,
      throughSeq: 2,
      limit: 10,
    });
    assert.deepEqual(
      orderedPage.map((event) => event.memorySeq),
      [1, 2],
    );
    const exclusivePage = await memoryStore.listBranch({
      accountId,
      branch: "a",
      afterSeq: 1,
      throughSeq: 2,
      limit: 10,
    });
    assert.deepEqual(
      exclusivePage.map((event) => event.memorySeq),
      [2],
    );
    const otherBranch = await memoryStore.listBranch({
      accountId,
      branch: "b",
      afterSeq: 0,
      throughSeq: 2,
      limit: 10,
    });
    assert.deepEqual(
      otherBranch.map((event) => event.memorySeq),
      [1],
    );
  });

  await t.test("artifacts are globally content-addressed and preserve inline null", async () => {
    // The content carries the run nonce on purpose: artifacts are deduplicated
    // by content hash across the whole database, so a constant payload could
    // only ever be appended once and the suite would fail from the second run
    // onwards (the row would already exist and `appended` would be false).
    const content = { text: `content-addressing-${nonce}` };
    const contentHash = sha256CanonicalJson(content);
    const first = await artifactStore.put({
      artifactId: `artifact-${nonce}-1`,
      kind: ARTIFACT_KIND.SUMMARY,
      schemaVersion: 1,
      sha256: contentHash,
      inlineJson: content,
    });
    const duplicate = await artifactStore.put({
      artifactId: `artifact-${nonce}-2`,
      kind: ARTIFACT_KIND.SUMMARY,
      schemaVersion: 1,
      sha256: contentHash,
      inlineJson: content,
    });
    assert.equal(first.appended, true);
    assert.equal(duplicate.appended, false);
    assert.equal(duplicate.value.artifactId, first.value.artifactId);

    // `null` is a legal inline value and must survive the round trip unchanged
    // rather than being coerced to `{}` or `undefined`. Its hash is a constant,
    // so this row may already exist from an earlier run — only the preserved
    // value is asserted, never `appended`.
    const nullHash = sha256CanonicalJson(null);
    const nullInline = await artifactStore.put({
      artifactId: `artifact-${nonce}-null`,
      kind: ARTIFACT_KIND.SUMMARY,
      schemaVersion: 1,
      sha256: nullHash,
      inlineJson: null,
    });
    assert.equal(nullInline.value.inlineJson, null);
  });

  await t.test("event and artifact timestamps are generated by PostgreSQL", async () => {
    const [{ now: before }] = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS "now"
    `;
    const event = await conversationStore.append(conversationInput(300));
    const content = { text: `timestamp-${nonce}` };
    const artifact = await artifactStore.put({
      artifactId: `artifact-${nonce}-timestamp`,
      kind: ARTIFACT_KIND.SUMMARY,
      schemaVersion: 1,
      sha256: sha256CanonicalJson(content),
      inlineJson: content,
    });
    const [{ now: after }] = await prisma.$queryRaw<Array<{ now: Date }>>`
      SELECT CURRENT_TIMESTAMP AS "now"
    `;

    const recordedAt = new Date(event.value.recordedAt);
    const createdAt = new Date(artifact.value.createdAt);
    assert.ok(recordedAt >= before && recordedAt <= after);
    assert.ok(createdAt >= before && createdAt <= after);

    const eventRow = await prisma.conversationEvent.findUniqueOrThrow({
      where: { eventId: event.value.eventId },
    });
    const artifactRow = await prisma.artifactRevision.findUniqueOrThrow({
      where: { artifactId: artifact.value.artifactId },
    });
    assert.equal(eventRow.recordedAt.toISOString(), event.value.recordedAt);
    assert.equal(artifactRow.createdAt.toISOString(), artifact.value.createdAt);
  });

  await t.test("a conflicting concurrent insert rolls back its allocated sequence", async () => {
    const streamId = `stream-${nonce}`;
    const headBefore = await prisma.conversationStreamHead.findUniqueOrThrow({
      where: { accountId_streamId: { accountId, streamId } },
    });
    const firstInput = conversationInput(400);
    const outcomes = await Promise.allSettled([
      conversationStore.append(firstInput),
      conversationStore.append({
        ...firstInput,
        idempotencyKey: `${firstInput.idempotencyKey}:conflict`,
        payload: { ...firstInput.payload, text: "conflicting content" },
      }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0]?.reason instanceof FactLedgerIdConflictError);
    assert.equal(
      await prisma.conversationEvent.count({ where: { eventId: firstInput.eventId } }),
      1,
    );

    const headAfterFailure = await prisma.conversationStreamHead.findUniqueOrThrow({
      where: { accountId_streamId: { accountId, streamId } },
    });
    assert.equal(headAfterFailure.lastSeq, headBefore.lastSeq + 1);

    const next = await conversationStore.append(conversationInput(401));
    assert.equal(next.value.streamSeq, headBefore.lastSeq + 2);
  });

  await t.test(
    "immutable rows reject update and delete while heads update timestamps",
    async () => {
      const headBefore = await prisma.conversationStreamHead.findUniqueOrThrow({
        where: { accountId_streamId: { accountId, streamId: `stream-${nonce}` } },
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
      await conversationStore.append(conversationInput(200));
      const headAfter = await prisma.conversationStreamHead.findUniqueOrThrow({
        where: { accountId_streamId: { accountId, streamId: `stream-${nonce}` } },
      });
      assert.ok(headAfter.updatedAt > headBefore.updatedAt);

      await assert.rejects(
        () =>
          prisma.$executeRaw`UPDATE "conversation_events" SET "event_type" = 'changed' WHERE "event_id" = ${`conversation-event-${nonce}-0`}`,
      );
      await assert.rejects(
        () =>
          prisma.$executeRaw`DELETE FROM "agent_run_events" WHERE "event_id" = ${`run-event-${nonce}-1`}`,
      );
      await assert.rejects(
        () =>
          prisma.$executeRaw`UPDATE "memory_events" SET "event_type" = 'changed' WHERE "event_id" = ${`memory-${nonce}-a-1`}`,
      );
      await assert.rejects(
        () =>
          prisma.$executeRaw`DELETE FROM "artifact_revisions" WHERE "artifact_id" = ${`artifact-${nonce}-1`}`,
      );
      await assert.rejects(() => prisma.account.delete({ where: { id: accountId } }));
    },
  );
});
