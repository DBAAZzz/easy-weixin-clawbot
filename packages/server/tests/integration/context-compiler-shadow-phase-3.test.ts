import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID,
  CONTEXT_TIMEZONE,
  ContextCompilerShadowResultEquivalenceError,
  createContextCompilerV1,
  emptyContextCompilerShadowDiffCounts,
} from "@clawbot/agent";
import { PrismaClient } from "@prisma/client";
import {
  clearIngressSession,
  repairIngressClear,
  type ClearIngressSessionStep,
} from "../../src/db/clear-ingress-session.js";
import { PrismaContextCompilerShadowResultStore } from "../../src/db/context-compiler-shadow-result-store.js";
import { PrismaContextCompilerShadowRolloutStore } from "../../src/db/context-compiler-shadow-rollout-store.js";
import { PrismaConversationEventStore } from "../../src/db/conversation-event-store.impl.js";

const databaseUrl = process.env.FACT_LEDGER_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("FACT_LEDGER_TEST_DATABASE_URL is required");
const databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1);
if (!databaseName?.endsWith("_fact_ledger_test")) {
  throw new Error("Fact ledger integration tests require a database ending in _fact_ledger_test");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const eventStore = new PrismaConversationEventStore(prisma);
const resultStore = new PrismaContextCompilerShadowResultStore(prisma);
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

after(async () => prisma.$disconnect());

async function setupClearFixture(suffix: string) {
  const accountId = `phase3-${nonce}-${suffix}`;
  const streamId = `user-${suffix}`;
  const effectiveConversationId = `${streamId}#legacy`;
  await prisma.account.create({ data: { id: accountId } });
  const prior = await eventStore.append({
    eventId: `prior-${nonce}-${suffix}`,
    accountId,
    streamId,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-28T00:00:00.000Z",
    receivedAt: "2026-08-28T00:00:01.000Z",
    actor: { kind: "user", id: streamId },
    payload: { channel: "weixin", text: "before clear", attachmentRefs: [] },
  });
  const source = await eventStore.append({
    eventId: `clear-${nonce}-${suffix}`,
    accountId,
    streamId,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-28T00:01:00.000Z",
    receivedAt: "2026-08-28T00:01:01.000Z",
    actor: { kind: "user", id: streamId },
    payload: { channel: "weixin", text: "/clear", attachmentRefs: [] },
  });
  await prisma.weixinIngressDispatch.create({
    data: {
      eventId: source.value.eventId,
      accountId,
      status: "processing",
      attemptCount: 1,
      claimedAt: new Date(),
    },
  });
  await prisma.sessionRoute.create({
    data: { accountId, wechatConvId: streamId, effectiveConvId: effectiveConversationId },
  });
  const message = await prisma.message.create({
    data: {
      accountId,
      conversationId: effectiveConversationId,
      seq: 1,
      role: "user",
      contentText: "before clear",
      payload: { role: "user", content: "before clear", timestamp: 1 },
    },
  });
  await prisma.conversation.create({
    data: {
      accountId,
      conversationId: effectiveConversationId,
      messageCount: 1,
      lastMessageAt: new Date(),
    },
  });
  await prisma.legacyMessageProjectionLink.create({
    data: {
      eventId: prior.value.eventId,
      accountId,
      conversationId: effectiveConversationId,
      messageSeq: 1,
      messageId: message.id,
    },
  });
  return { accountId, streamId, effectiveConversationId, sourceEventId: source.value.eventId };
}

test("/clear commits marker, legacy clear, route deletion and boundary atomically", async () => {
  const fixture = await setupClearFixture("success");
  const result = await clearIngressSession(
    {
      accountId: fixture.accountId,
      receiptId: fixture.sourceEventId,
      wechatConversationId: fixture.streamId,
      effectiveConversationId: fixture.effectiveConversationId,
    },
    { prisma },
  );

  const receipt = await prisma.weixinIngressDispatch.findUniqueOrThrow({
    where: { eventId: fixture.sourceEventId },
  });
  assert.equal(receipt.commandName, "clear");
  assert.equal(await prisma.message.count({ where: { accountId: fixture.accountId } }), 0);
  assert.equal(await prisma.sessionRoute.count({ where: { accountId: fixture.accountId } }), 0);
  const link = await prisma.legacyMessageProjectionLink.findFirstOrThrow({
    where: { accountId: fixture.accountId },
  });
  assert.equal(link.state, "cleared");
  assert.equal(link.messageId, null);
  assert.ok(link.clearedAt);
  const boundary = await prisma.conversationEvent.findUniqueOrThrow({
    where: { eventId: result.boundaryEventId },
  });
  assert.equal(boundary.eventType, "session_rotated");
  assert.equal(boundary.causationId, fixture.sourceEventId);
  assert.equal(boundary.streamId, fixture.streamId);
  assert.equal(boundary.streamSeq, 3);

  const compiled = await createContextCompilerV1({ conversationEventStore: eventStore }).compile({
    accountId: fixture.accountId,
    conversationStreamId: fixture.streamId,
    eventCursor: boundary.streamSeq,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID,
    effectiveTime: "2026-08-28T08:02:00.000+08:00",
    timezone: CONTEXT_TIMEZONE,
  });
  assert.equal(compiled.context.sessionBoundaryEventId, boundary.eventId);
  assert.deepEqual(compiled.context.entries, []);

  // Re-running the same receipt (crash retry before settle) must reuse the
  // existing boundary instead of clearing again.
  const rerun = await clearIngressSession(
    {
      accountId: fixture.accountId,
      receiptId: fixture.sourceEventId,
      wechatConversationId: fixture.streamId,
      effectiveConversationId: fixture.streamId,
    },
    { prisma },
  );
  assert.equal(rerun.boundaryEventId, result.boundaryEventId);
  assert.equal(rerun.deletedMessageCount, 0);
  assert.equal(
    await prisma.conversationEvent.count({
      where: { accountId: fixture.accountId, eventType: "session_rotated" },
    }),
    1,
  );
});

for (const failAfter of [
  "command_marked",
  "messages_cleared",
  "route_deleted",
  "boundary_appended",
] as const satisfies readonly ClearIngressSessionStep[]) {
  test(`clear fault after ${failAfter} rolls back every database side effect`, async () => {
    const fixture = await setupClearFixture(`fault-${failAfter}`);
    await assert.rejects(
      () =>
        clearIngressSession(
          {
            accountId: fixture.accountId,
            receiptId: fixture.sourceEventId,
            wechatConversationId: fixture.streamId,
            effectiveConversationId: fixture.effectiveConversationId,
          },
          {
            prisma,
            afterStep(step) {
              if (step === failAfter) throw new Error(`fault:${step}`);
            },
          },
        ),
      new RegExp(`fault:${failAfter}`),
    );
    const receipt = await prisma.weixinIngressDispatch.findUniqueOrThrow({
      where: { eventId: fixture.sourceEventId },
    });
    assert.equal(receipt.commandName, null);
    assert.equal(await prisma.message.count({ where: { accountId: fixture.accountId } }), 1);
    assert.equal(await prisma.sessionRoute.count({ where: { accountId: fixture.accountId } }), 1);
    const link = await prisma.legacyMessageProjectionLink.findFirstOrThrow({
      where: { accountId: fixture.accountId },
    });
    assert.equal(link.state, "persisted");
    assert.equal(
      await prisma.conversationEvent.count({
        where: { accountId: fixture.accountId, eventType: "session_rotated" },
      }),
      0,
    );
  });
}

test("shadow result replay is equivalent-only and foreign keys bind account to source", async () => {
  const fixture = await setupClearFixture("shadow-result");
  const base = {
    sourceEventId: fixture.sourceEventId,
    accountId: fixture.accountId,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID,
    eventCursor: 2,
    effectiveTime: "2026-08-28T08:00:00.000+08:00",
    timezone: CONTEXT_TIMEZONE,
    canonicalContextHash: "a".repeat(64),
    canonicalMemoryInputHash: "b".repeat(64),
    legacySummaryHash: "c".repeat(64),
    canonicalEntryCount: 2,
    legacyEntryCount: 2,
    diffCounts: emptyContextCompilerShadowDiffCounts(),
    status: "success" as const,
  };
  await resultStore.createOrVerifyEquivalent(base);
  await resultStore.createOrVerifyEquivalent(base);
  await assert.rejects(
    () =>
      resultStore.createOrVerifyEquivalent({
        ...base,
        effectiveTime: "2026-08-28T08:00:01.000+08:00",
      }),
    ContextCompilerShadowResultEquivalenceError,
  );

  const otherAccountId = `phase3-${nonce}-other-account`;
  await prisma.account.create({ data: { id: otherAccountId } });
  await assert.rejects(() =>
    resultStore.createOrVerifyEquivalent({
      ...base,
      accountId: otherAccountId,
      contextPolicyRevisionId: "context-policy-v1-fk-test",
    }),
  );
});

test("admin clear repair derives all content from a terminal source receipt id", async () => {
  const fixture = await setupClearFixture("repair");
  await prisma.weixinIngressDispatch.update({
    where: { eventId: fixture.sourceEventId },
    data: { status: "completed", outcome: "command", completedAt: new Date() },
  });
  const result = await repairIngressClear(
    fixture.sourceEventId,
    { operator: "ops-1", reason: "torn clear recovery" },
    prisma,
  );
  const boundary = await prisma.conversationEvent.findUniqueOrThrow({
    where: { eventId: result.boundaryEventId },
  });
  assert.equal(boundary.causationId, fixture.sourceEventId);
  assert.equal(await prisma.message.count({ where: { accountId: fixture.accountId } }), 0);
  const receipt = await prisma.weixinIngressDispatch.findUniqueOrThrow({
    where: { eventId: fixture.sourceEventId },
  });
  assert.equal(receipt.commandName, "clear");
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.recoveryOperator, "ops-1");
  assert.equal(receipt.recoveryReason, "torn clear recovery");
  assert.ok(receipt.recoveredAt);
});

test("repair is idempotent once the causation boundary exists", async () => {
  const fixture = await setupClearFixture("repair-idempotent");
  await prisma.weixinIngressDispatch.update({
    where: { eventId: fixture.sourceEventId },
    data: { status: "completed", outcome: "command", completedAt: new Date() },
  });
  const first = await repairIngressClear(
    fixture.sourceEventId,
    { operator: "ops-1", reason: "first repair" },
    prisma,
  );

  // Traffic resumed after the repair; a repeated repair must not wipe it.
  await prisma.message.create({
    data: {
      accountId: fixture.accountId,
      conversationId: fixture.effectiveConversationId,
      seq: 1,
      role: "user",
      contentText: "after repair",
      payload: { role: "user", content: "after repair", timestamp: 2 },
    },
  });
  const second = await repairIngressClear(
    fixture.sourceEventId,
    { operator: "ops-2", reason: "repeat run" },
    prisma,
  );

  assert.equal(second.boundaryEventId, first.boundaryEventId);
  assert.equal(second.deletedMessageCount, 0);
  assert.equal(
    await prisma.message.count({ where: { accountId: fixture.accountId } }),
    1,
  );
  assert.equal(
    await prisma.conversationEvent.count({
      where: { accountId: fixture.accountId, eventType: "session_rotated" },
    }),
    1,
  );
  assert.equal(await prisma.sessionRoute.count({ where: { accountId: fixture.accountId } }), 0);
  const receipt = await prisma.weixinIngressDispatch.findUniqueOrThrow({
    where: { eventId: fixture.sourceEventId },
  });
  assert.equal(receipt.recoveryOperator, "ops-2");
  assert.equal(receipt.recoveryReason, "repeat run");
});

test("rollout is disabled when no row exists and result table has no body columns", async () => {
  const accountId = `phase3-${nonce}-rollout`;
  await prisma.account.create({ data: { id: accountId } });
  assert.equal(
    await new PrismaContextCompilerShadowRolloutStore(prisma).isEnabled(accountId),
    false,
  );
  const columns = await prisma.$queryRaw<Array<{ columnName: string }>>`
    SELECT column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'context_compiler_shadow_results'
  `;
  const names = columns.map((column) => column.columnName);
  for (const forbidden of ["text", "payload", "prompt", "metadata", "local_path"]) {
    assert.equal(names.includes(forbidden), false);
  }
});
