import assert from "node:assert/strict";
import test from "node:test";
import type { ValidatedWeixinInbound } from "@clawbot/weixin-agent-sdk";
import { mapWeixinInboundEvent } from "../../src/weixin/inbound-mapper.js";

function inbound(): ValidatedWeixinInbound {
  return {
    conversationId: "user-1",
    senderId: "user-1",
    recipientId: "bot-1",
    seq: 9,
    clientId: "client-1",
    occurredAtMs: 1_000,
    receivedAtMs: 2_000,
    items: [
      { index: 0, type: 1, text: "当前原文", isMedia: false, hasReferencedMedia: false, refMsgId: "quoted-1", refType: 1 },
      { index: 1, type: 2, isMedia: true, hasReferencedMedia: false },
    ],
  };
}

test("maps a stable account-scoped event without derived quoted text", () => {
  const first = mapWeixinInboundEvent("account-1", inbound());
  const retry = mapWeixinInboundEvent("account-1", inbound());
  const otherAccount = mapWeixinInboundEvent("account-2", inbound());
  assert.equal(first.eventId, retry.eventId);
  assert.notEqual(first.eventId, otherAccount.eventId);
  assert.equal(first.idempotencyKey, "weixin:v1:client-seq:client-1:9");
  assert.equal(first.streamId, "user-1");
  if (first.eventType !== "inbound_message_received") throw new Error("unexpected event type");
  assert.equal(first.payload.text, "当前原文");
  assert.equal(first.payload.attachmentRefs.length, 1);
  assert.equal("streamSeq" in first, false);
});

test("quoted media receives a deterministic source attachment reference", () => {
  const input = inbound();
  input.items[0] = { ...input.items[0]!, refType: 2, hasReferencedMedia: true };
  const event = mapWeixinInboundEvent("account-1", input);
  if (event.eventType !== "inbound_message_received") throw new Error("unexpected event type");
  assert.equal(event.payload.attachmentRefs.length, 2);
});

test("metadata contains only the reviewed v1 fields", () => {
  const event = mapWeixinInboundEvent("account-1", inbound());
  if (event.eventType !== "inbound_message_received") throw new Error("unexpected event type");
  const metadata = event.payload.channelMetadata?.data;
  assert.deepEqual(Object.keys(metadata ?? {}).sort(), [
    "clientId", "identitySource", "items", "recipientId", "seq",
  ]);
  assert.equal(JSON.stringify(metadata).includes("当前原文"), false);
});

test("rejects hidden and derived fields instead of silently dropping them", () => {
  const polluted = inbound() as ValidatedWeixinInbound & { effectiveTime?: string };
  polluted.effectiveTime = "later";
  assert.throws(() => mapWeixinInboundEvent("account-1", polluted), /unexpected_field/);

  const symbol = Symbol("hidden");
  const hidden = inbound() as ValidatedWeixinInbound & Record<symbol, string>;
  Object.defineProperty(hidden, symbol, { value: "secret", enumerable: false });
  assert.throws(() => mapWeixinInboundEvent("account-1", hidden), /unexpected_field/);
});
