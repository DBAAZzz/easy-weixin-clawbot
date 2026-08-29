import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationEvent, ConversationEventStore } from "@clawbot/agent";
import type { ValidatedWeixinInbound } from "@clawbot/weixin-agent-sdk";
import type { ServerWeixinAgent } from "../agent.js";
import { createWeixinIngressLifecycle } from "./ingress-controller.js";

const input: ValidatedWeixinInbound = {
  conversationId: "user-1",
  senderId: "user-1",
  seq: 1,
  clientId: "client-1",
  occurredAtMs: 1_000,
  receivedAtMs: 2_000,
  items: [{ index: 0, type: 1, text: "hello", isMedia: false, hasReferencedMedia: false }],
};

test("controller appends, claims, resolves source event, and settles", async () => {
  let stored: ConversationEvent | null = null;
  let appendCount = 0;
  let claimed = true;
  let invokedSource: Pick<ConversationEvent, "eventId"> | undefined;
  let cleared: [string, string] | undefined;
  let settled: [string, string, string | undefined] | undefined;
  const eventStore: ConversationEventStore = {
    async append(event) {
      appendCount += 1;
      stored = {
        ...event,
        streamSeq: 1,
        recordedAt: "2026-08-28T00:00:00.000Z",
      } as ConversationEvent;
      return { value: stored, appended: true };
    },
    async getById() {
      return stored;
    },
    async listStream() {
      return stored ? [stored] : [];
    },
  };
  const dispatchStore = {
    async createAndClaim() {
      return claimed;
    },
    async get(eventId: string) {
      return {
        eventId,
        accountId: "account-1",
        status: "processing" as const,
        outcome: null,
        attemptCount: 1,
        claimedAt: new Date(),
        completedAt: null,
        errorCode: null,
      };
    },
    async settle(eventId: string, outcome: "chat" | "command" | "failed", errorCode?: string) {
      settled = [eventId, outcome, errorCode];
    },
  };
  const agent: ServerWeixinAgent = {
    async chat() {
      throw new Error("legacy chat must not be used");
    },
    async chatFromIngress(_request, source) {
      invokedSource = source;
      return { text: "ok" };
    },
    async clearFromIngress(receiptId, wechatConversationId) {
      cleared = [receiptId, wechatConversationId];
    },
  };
  const lifecycle = createWeixinIngressLifecycle({
    accountId: "account-1",
    rolloutEnabled: true,
    agent,
    eventStore,
    dispatchStore,
  });

  const accepted = await lifecycle.accept(input);
  assert.equal(accepted.disposition, "process");
  assert.ok(stored);
  await lifecycle.invokeAgent({
    receiptId: accepted.receiptId,
    request: { conversationId: "user-1", text: "hello" },
  });
  assert.equal(invokedSource?.eventId, accepted.receiptId);
  await lifecycle.settle({ receiptId: accepted.receiptId, outcome: "chat" });
  assert.deepEqual(settled, [accepted.receiptId, "chat", undefined]);

  await lifecycle.invokeClear({
    receiptId: accepted.receiptId,
    conversationId: "user-1",
  });
  assert.deepEqual(cleared, [accepted.receiptId, "user-1"]);

  claimed = false;
  assert.equal((await lifecycle.accept(input)).disposition, "skip");

  const disabled = createWeixinIngressLifecycle({
    accountId: "account-1",
    rolloutEnabled: false,
    agent,
    eventStore,
    dispatchStore,
  });
  const beforeDisabled = appendCount;
  await assert.rejects(() => disabled.accept(input), /rollout_disabled/);
  assert.equal(appendCount, beforeDisabled);
});
