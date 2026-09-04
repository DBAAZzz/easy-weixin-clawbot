import { createHash } from "node:crypto";
import {
  parseAppendConversationEventInput,
  type AppendConversationEventInput,
  type JsonValue,
} from "@clawbot/agent";
import type { ValidatedWeixinInbound } from "@clawbot/weixin-agent-sdk";

const INBOUND_KEYS = new Set([
  "conversationId", "senderId", "recipientId", "groupId", "seq", "clientId",
  "messageId", "occurredAtMs", "receivedAtMs", "sessionId", "messageType",
  "messageState", "items",
]);
const ITEM_KEYS = new Set([
  "index", "type", "msgId", "createTimeMs", "isCompleted", "refMsgId", "refType",
  "text", "voiceText", "isMedia", "hasReferencedMedia",
]);

function assertExactObject(value: object, allowed: Set<string>, label: string): void {
  const unexpected = Reflect.ownKeys(value).filter(
    (key) => typeof key !== "string" || !allowed.has(key),
  );
  if (unexpected.length > 0) throw new Error(`invalid_weixin_metadata:${label}:unexpected_field`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function weixinSourceIdentity(input: ValidatedWeixinInbound): string {
  if (input.messageId !== undefined) return `message:${input.messageId}`;
  if (!input.clientId) throw new Error("invalid_weixin_metadata:source_identity");
  return `client-seq:${input.clientId}:${input.seq}`;
}

export function mapWeixinInboundEvent(
  accountId: string,
  input: ValidatedWeixinInbound,
): AppendConversationEventInput {
  assertExactObject(input, INBOUND_KEYS, "inbound");
  if (!accountId || !input.senderId || input.conversationId !== input.senderId) {
    throw new Error("invalid_weixin_metadata:identity");
  }
  if (!Number.isSafeInteger(input.seq) || input.seq < 0
    || !Number.isSafeInteger(input.occurredAtMs) || input.occurredAtMs < 0
    || !Number.isSafeInteger(input.receivedAtMs) || input.receivedAtMs < 0) {
    throw new Error("invalid_weixin_metadata:time");
  }
  if (input.messageId === undefined && !input.clientId) {
    throw new Error("invalid_weixin_metadata:source_identity");
  }
  input.items.forEach((item, index) => {
    assertExactObject(item, ITEM_KEYS, `item_${index}`);
    if (item.index !== index) throw new Error("invalid_weixin_metadata:item_index");
  });
  if (input.groupId) throw new Error("unsupported_group_chat");

  const sourceIdentity = weixinSourceIdentity(input);
  const canonicalText = input.items.find((item) => item.text !== undefined)?.text
    ?? input.items.find((item) => item.voiceText !== undefined)?.voiceText
    ?? "";
  const attachmentRefs = input.items
    .filter((item) => item.isMedia || item.hasReferencedMedia)
    .map((item) => `weixin-attachment-v1:${sha256(`${accountId}\0${sourceIdentity}\0${item.index}`)}`);

  const metadata: Record<string, JsonValue> = {
    identitySource: input.messageId !== undefined ? "message_id" : "client_id_seq",
    seq: input.seq,
    items: input.items.map((item) => ({
      index: item.index,
      ...(item.type === undefined ? {} : { type: item.type }),
      ...(item.msgId === undefined ? {} : { msgId: item.msgId }),
      ...(item.createTimeMs === undefined ? {} : { createTimeMs: item.createTimeMs }),
      ...(item.isCompleted === undefined ? {} : { isCompleted: item.isCompleted }),
      ...(item.refMsgId === undefined ? {} : { refMsgId: item.refMsgId }),
      ...(item.refType === undefined ? {} : { refType: item.refType }),
    })),
  };
  if (input.clientId !== undefined) metadata.clientId = input.clientId;
  if (input.messageId !== undefined) metadata.messageId = input.messageId;
  if (input.recipientId !== undefined) metadata.recipientId = input.recipientId;
  if (input.sessionId !== undefined) metadata.sessionId = input.sessionId;
  if (input.messageType !== undefined) metadata.messageType = input.messageType;
  if (input.messageState !== undefined) metadata.messageState = input.messageState;

  return parseAppendConversationEventInput({
    eventId: `weixin-inbound-v1:${sha256(`${accountId}\0${sourceIdentity}`)}`,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    accountId,
    streamId: input.senderId,
    occurredAt: new Date(input.occurredAtMs).toISOString(),
    receivedAt: new Date(input.receivedAtMs).toISOString(),
    actor: { kind: "user", id: input.senderId },
    idempotencyKey: `weixin:v1:${sourceIdentity}`,
    payload: {
      channel: "weixin",
      channelMessageId: sourceIdentity,
      senderSnapshot: { id: input.senderId },
      text: canonicalText,
      attachmentRefs,
      channelMetadata: {
        schemaId: "weixin/inbound-message",
        schemaVersion: 1,
        data: metadata,
      },
    },
  });
}
