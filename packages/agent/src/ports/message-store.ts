/**
 * MessageStore — agent-defined interface for message persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

import type { Message } from "@mariozechner/pi-ai";

export interface RestoredHistory {
  messages: Message[];
  maxSeq: number;
}

export interface PersistMessageParams {
  accountId: string;
  conversationId: string;
  message: Message;
  seq: number;
  mediaSourcePath?: string;
}

export interface MessagesSinceRow {
  seq: number;
  role: string;
  textContent: string;
}

export interface MessageStore {
  restoreHistory(accountId: string, conversationId: string): Promise<RestoredHistory>;
  queuePersistMessage(params: PersistMessageParams): void;
  rollbackMessages(accountId: string, conversationId: string, count: number): Promise<void>;
  clearMessages(accountId: string, conversationId: string): Promise<void>;
  /** Read messages with seq > sinceSeq (up to limit). Used by heartbeat to read incremental context. */
  getMessagesSince(
    accountId: string,
    conversationId: string,
    sinceSeq: number,
    limit: number,
  ): Promise<MessagesSinceRow[]>;
}

let store: MessageStore | null = null;

export function setMessageStore(impl: MessageStore): void {
  store = impl;
}

export function getMessageStore(): MessageStore {
  if (!store) throw new Error("MessageStore not initialized — call setMessageStore() at startup");
  return store;
}
