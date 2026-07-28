/**
 * MessageStore — agent-defined interface for message persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

import type { AgentMessage } from "../llm/types.js";
import { createPortSlot } from "./slot.js";

export interface RestoredHistory {
  messages: AgentMessage[];
  maxSeq: number;
}

export interface PersistMessageParams {
  accountId: string;
  conversationId: string;
  message: AgentMessage;
  seq: number;
  mediaSourcePath?: string;
}

export interface MessageStore {
  restoreHistory(accountId: string, conversationId: string): Promise<RestoredHistory>;
  queuePersistMessage(params: PersistMessageParams): void;
  rollbackMessages(accountId: string, conversationId: string, count: number): Promise<void>;
  clearMessages(accountId: string, conversationId: string): Promise<void>;
}

export const { set: setMessageStore, get: getMessageStore } =
  createPortSlot<MessageStore>("MessageStore", "setMessageStore");
