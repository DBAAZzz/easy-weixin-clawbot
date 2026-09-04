import type { MessageItem, WeixinMessage } from "../api/types.js";

export interface ValidatedWeixinItem {
  index: number;
  type?: number;
  msgId?: string;
  createTimeMs?: number;
  isCompleted?: boolean;
  refMsgId?: string;
  refType?: number;
  text?: string;
  voiceText?: string;
  isMedia: boolean;
  hasReferencedMedia: boolean;
}

export interface ValidatedWeixinInbound {
  conversationId: string;
  senderId: string;
  recipientId?: string;
  groupId?: string;
  seq: number;
  clientId?: string;
  messageId?: number;
  occurredAtMs: number;
  receivedAtMs: number;
  sessionId?: string;
  messageType?: number;
  messageState?: number;
  items: ValidatedWeixinItem[];
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`invalid_weixin_ingress:${field}`);
  }
  return value;
}

function optionalNonEmpty(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : requireNonEmpty(value, field);
}

function requireSafeTime(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`invalid_weixin_ingress:${field}`);
  }
  return value as number;
}

function optionalSafeTime(value: unknown, field: string): number | undefined {
  return value === undefined ? undefined : requireSafeTime(value, field);
}

function validateItem(item: MessageItem, index: number): ValidatedWeixinItem {
  const type = optionalSafeTime(item.type, `item_list.${index}.type`);
  const ref = item.ref_msg?.message_item;
  if (item.is_completed !== undefined && typeof item.is_completed !== "boolean") {
    throw new Error(`invalid_weixin_ingress:item_list.${index}.is_completed`);
  }
  if (item.text_item?.text !== undefined && typeof item.text_item.text !== "string") {
    throw new Error(`invalid_weixin_ingress:item_list.${index}.text`);
  }
  if (item.voice_item?.text !== undefined && typeof item.voice_item.text !== "string") {
    throw new Error(`invalid_weixin_ingress:item_list.${index}.voice_text`);
  }
  return {
    index,
    type,
    msgId: optionalNonEmpty(item.msg_id, `item_list.${index}.msg_id`),
    createTimeMs: optionalSafeTime(item.create_time_ms, `item_list.${index}.create_time_ms`),
    ...(item.is_completed === undefined ? {} : { isCompleted: item.is_completed }),
    refMsgId: optionalNonEmpty(ref?.msg_id, `item_list.${index}.ref_msg.msg_id`),
    refType: optionalSafeTime(ref?.type, `item_list.${index}.ref_msg.type`),
    ...(type === 1 && item.text_item?.text !== undefined
      ? { text: item.text_item.text }
      : {}),
    ...(type === 3 && item.voice_item?.text !== undefined
      ? { voiceText: item.voice_item.text }
      : {}),
    isMedia: type === 2 || type === 3 || type === 4 || type === 5,
    hasReferencedMedia:
      ref?.type === 2 || ref?.type === 3 || ref?.type === 4 || ref?.type === 5,
  };
}

export function validateWeixinInbound(
  message: WeixinMessage,
  receivedAtMs: number,
): ValidatedWeixinInbound {
  const senderId = requireNonEmpty(message.from_user_id, "from_user_id");
  const seq = requireSafeTime(message.seq, "seq");
  const occurredAtMs = requireSafeTime(message.create_time_ms, "create_time_ms");
  const received = requireSafeTime(receivedAtMs, "received_at_ms");
  const messageId = optionalSafeTime(message.message_id, "message_id");
  const clientId = optionalNonEmpty(message.client_id, "client_id");
  const groupId = optionalNonEmpty(message.group_id, "group_id");

  if (groupId) throw new Error("unsupported_group_chat");
  if (messageId === undefined && clientId === undefined) {
    throw new Error("invalid_weixin_ingress:identity");
  }

  return {
    conversationId: senderId,
    senderId,
    recipientId: optionalNonEmpty(message.to_user_id, "to_user_id"),
    seq,
    clientId,
    messageId,
    occurredAtMs,
    receivedAtMs: received,
    sessionId: optionalNonEmpty(message.session_id, "session_id"),
    messageType: optionalSafeTime(message.message_type, "message_type"),
    messageState: optionalSafeTime(message.message_state, "message_state"),
    items: (message.item_list ?? []).map(validateItem),
  };
}
