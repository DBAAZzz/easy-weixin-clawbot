import assert from "node:assert/strict";
import { after, test } from "node:test";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import { PrismaClient } from "@prisma/client";
import type { ValidatedWeixinInbound } from "@clawbot/weixin-agent-sdk";
import type { ServerWeixinAgent } from "../../src/agent.js";
import { PrismaConversationEventStore } from "../../src/db/conversation-event-store.impl.js";
import { reconcileWeixinIngress } from "../../src/db/fact-ledger-reconciliation.js";
import { PrismaMessageStore } from "../../src/db/message-store.impl.js";
import { queuePersistMessage } from "../../src/db/messages.js";
import { WeixinIngressDispatchStore } from "../../src/db/weixin-ingress-dispatch-store.js";
import { createWeixinIngressLifecycle } from "../../src/weixin/ingress-controller.js";
import { mapWeixinInboundEvent } from "../../src/weixin/inbound-mapper.js";

const databaseUrl = process.env.FACT_LEDGER_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("FACT_LEDGER_TEST_DATABASE_URL is required");
const databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1);
if (!databaseName?.endsWith("_fact_ledger_test")) {
  throw new Error("Fact ledger integration tests require a database ending in _fact_ledger_test");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `weixin-phase-2-${nonce}`;
const otherAccountId = `weixin-phase-2-other-${nonce}`;
const eventStore = new PrismaConversationEventStore(prisma);
const dispatchStore = new WeixinIngressDispatchStore(prisma);
const agent: ServerWeixinAgent = {
  chat: async () => ({ text: "ok" }),
  chatFromIngress: async () => ({ text: "ok" }),
  clearFromIngress: async () => {},
};
const lifecycle = createWeixinIngressLifecycle({
  accountId,
  rolloutEnabled: true,
  agent,
  eventStore,
  dispatchStore,
});

after(async () => prisma.$disconnect());

function inbound(index: number): ValidatedWeixinInbound {
  return {
    conversationId: `user-${nonce}`,
    senderId: `user-${nonce}`,
    recipientId: accountId,
    seq: index,
    clientId: `client-${nonce}`,
    occurredAtMs: 1_777_000_000_000 + index,
    receivedAtMs: 1_777_000_001_000 + index,
    items: [
      {
        index: 0,
        type: 1,
        text: `message ${index}`,
        isMedia: false,
        hasReferencedMedia: false,
      },
    ],
  };
}

async function createProjection(eventId: string, seq: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        accountId,
        conversationId: `user-${nonce}`,
        seq,
        role: "user",
        contentText: `message ${seq}`,
        payload: { role: "user", content: [] },
      },
    });
    await tx.legacyMessageProjectionLink.create({
      data: {
        eventId,
        accountId,
        conversationId: `user-${nonce}`,
        messageSeq: seq,
        messageId: message.id,
      },
    });
  });
}

test("Weixin ingress Phase 2 database invariants", async (t) => {
  await prisma.account.createMany({
    data: [{ id: accountId }, { id: otherAccountId }],
  });

  await t.test("concurrent accept appends one fact and claims once", async () => {
    const results = await Promise.all([lifecycle.accept(inbound(1)), lifecycle.accept(inbound(1))]);
    assert.deepEqual(results.map((result) => result.disposition).sort(), ["process", "skip"]);
    const eventId = results[0].receiptId;
    assert.equal(await prisma.conversationEvent.count({ where: { eventId } }), 1);
    const receipt = await prisma.weixinIngressDispatch.findUniqueOrThrow({ where: { eventId } });
    assert.equal(receipt.status, "processing");
    assert.equal(receipt.attemptCount, 1);
  });

  await t.test("an append-to-receipt crash gap is repaired by redelivery", async () => {
    const input = inbound(2);
    const event = await eventStore.append(mapWeixinInboundEvent(accountId, input));
    assert.equal(
      await prisma.weixinIngressDispatch.count({ where: { eventId: event.value.eventId } }),
      0,
    );
    const accepted = await lifecycle.accept(input);
    assert.equal(accepted.disposition, "process");
    assert.equal(
      await prisma.weixinIngressDispatch.count({ where: { eventId: event.value.eventId } }),
      1,
    );
  });

  await t.test("terminal and processing receipts never reclaim", async () => {
    const chat = await lifecycle.accept(inbound(3));
    await lifecycle.settle({ receiptId: chat.receiptId, outcome: "chat" });
    assert.equal((await lifecycle.accept(inbound(3))).disposition, "skip");

    const failed = await lifecycle.accept(inbound(4));
    await lifecycle.settle({
      receiptId: failed.receiptId,
      outcome: "failed",
      errorCode: "test_failure",
    });
    assert.equal((await lifecycle.accept(inbound(4))).disposition, "skip");

    const processing = await lifecycle.accept(inbound(5));
    assert.equal((await lifecycle.accept(inbound(5))).disposition, "skip");
    assert.equal((await dispatchStore.get(processing.receiptId))?.attemptCount, 1);
  });

  await t.test("dispatch account must match the source event in the database", async () => {
    const event = await eventStore.append(mapWeixinInboundEvent(accountId, inbound(6)));
    await assert.rejects(() =>
      prisma.weixinIngressDispatch.create({
        data: { eventId: event.value.eventId, accountId: otherAccountId },
      }),
    );
  });

  await t.test(
    "projection links are unique, account-safe, and reconcile normal links separately",
    async () => {
      const linked = await lifecycle.accept(inbound(7));
      await lifecycle.settle({ receiptId: linked.receiptId, outcome: "chat" });
      await createProjection(linked.receiptId, 700);
      await assert.rejects(() => createProjection(linked.receiptId, 701));
      await assert.rejects(() =>
        prisma.$transaction(async (tx) => {
          const foreignMessage = await tx.message.create({
            data: {
              accountId: otherAccountId,
              conversationId: `user-${nonce}`,
              seq: 1,
              role: "user",
              payload: { role: "user", content: [] },
            },
          });
          await tx.legacyMessageProjectionLink.create({
            data: {
              eventId: linked.receiptId,
              accountId: otherAccountId,
              conversationId: `user-${nonce}`,
              messageSeq: 1,
              messageId: foreignMessage.id,
            },
          });
        }),
      );

      const nonInbound = await eventStore.append({
        eventId: `session-event-${nonce}`,
        accountId,
        streamId: `user-${nonce}`,
        eventType: "session_started",
        schemaVersion: 1,
        occurredAt: "2026-08-28T00:00:00.000Z",
        receivedAt: "2026-08-28T00:00:00.001Z",
        actor: { kind: "system" },
        payload: { channel: "weixin", channelConversationId: `user-${nonce}` },
      });
      await assert.rejects(() =>
        prisma.$transaction(async (tx) => {
          const message = await tx.message.create({
            data: {
              accountId,
              conversationId: `user-${nonce}`,
              seq: 702,
              role: "user",
              payload: { role: "user", content: [] },
            },
          });
          await tx.legacyMessageProjectionLink.create({
            data: {
              eventId: nonInbound.value.eventId,
              accountId,
              conversationId: `user-${nonce}`,
              messageSeq: 702,
              messageId: message.id,
            },
          });
        }),
      );

      const report = await reconcileWeixinIngress(
        accountId,
        { graceSeconds: 0, stuckSeconds: 0 },
        prisma,
      );
      assert.ok(report.summary.linked >= 1);
      assert.equal(
        report.issues.some((issue) => issue.eventId === linked.receiptId),
        false,
      );
    },
  );

  await t.test("reconciliation reports missing and stuck while commands need no link", async () => {
    const command = await lifecycle.accept(inbound(8));
    await lifecycle.settle({ receiptId: command.receiptId, outcome: "command" });
    const missing = await lifecycle.accept(inbound(9));
    await lifecycle.settle({ receiptId: missing.receiptId, outcome: "chat" });
    const stuck = await lifecycle.accept(inbound(10));
    await prisma.$executeRaw`
      UPDATE "weixin_ingress_dispatches"
      SET "claimed_at" = CURRENT_TIMESTAMP - INTERVAL '10 minutes'
      WHERE "event_id" = ${stuck.receiptId}
    `;

    const report = await reconcileWeixinIngress(
      accountId,
      { graceSeconds: 0, stuckSeconds: 300 },
      prisma,
    );
    assert.ok(
      report.issues.some(
        (issue) => issue.eventId === missing.receiptId && issue.result === "missing",
      ),
    );
    assert.ok(
      report.issues.some((issue) => issue.eventId === stuck.receiptId && issue.result === "stuck"),
    );
    assert.equal(
      report.issues.some((issue) => issue.eventId === command.receiptId),
      false,
    );
  });

  await t.test(
    "message/link commit is atomic and clear waits for queued writes before tombstoning",
    async () => {
      const cleared = await lifecycle.accept(inbound(11));
      await lifecycle.settle({ receiptId: cleared.receiptId, outcome: "chat" });
      queuePersistMessage({
        accountId,
        conversationId: `user-${nonce}`,
        seq: 1100,
        sourceConversationEventId: cleared.receiptId,
        message: {
          role: MESSAGE_ROLE.USER,
          content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "message 11" }],
          timestamp: Date.now(),
        },
      });
      await new PrismaMessageStore().clearMessages(accountId, `user-${nonce}`);

      const link = await prisma.legacyMessageProjectionLink.findUniqueOrThrow({
        where: { eventId: cleared.receiptId },
      });
      assert.equal(link.state, "cleared");
      assert.equal(link.messageId, null);
      assert.ok(link.clearedAt);
      assert.equal(
        await prisma.message.count({
          where: { accountId, conversationId: `user-${nonce}`, seq: 1100 },
        }),
        0,
      );

      const conversation = await prisma.conversation.findUniqueOrThrow({
        where: {
          accountId_conversationId: {
            accountId,
            conversationId: `user-${nonce}`,
          },
        },
      });
      assert.equal(conversation.messageCount, 0);
      assert.equal(conversation.lastMessageAt, null);

      const report = await reconcileWeixinIngress(accountId, { graceSeconds: 0 }, prisma);
      assert.ok(report.summary.cleared >= 1);
      assert.equal(
        report.issues.some((issue) => issue.eventId === cleared.receiptId),
        false,
      );
    },
  );
});
