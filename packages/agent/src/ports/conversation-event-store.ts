import type {
  AppendConversationEventInput,
  AppendResult,
  ConversationEvent,
} from "../shared/fact-ledger/contracts.js";
import { createPortSlot } from "./slot.js";

export interface ListConversationEventsInput {
  accountId: string;
  streamId: string;
  afterSeq?: number;
  throughSeq?: number;
  limit: number;
}

export interface ConversationEventStore {
  append(input: AppendConversationEventInput): Promise<AppendResult<ConversationEvent>>;
  getById(eventId: string): Promise<ConversationEvent | null>;
  listStream(input: ListConversationEventsInput): Promise<ConversationEvent[]>;
  /**
   * Phase 6：trigger run 排序锚读取（§5.1）——执行流当前最后一个 streamSeq。
   * 空 stream → undefined。排序依据来自事实流本身，而非本地时钟。
   */
  getStreamHeadSeq(accountId: string, streamId: string): Promise<number | undefined>;
}

export const { set: setConversationEventStore, get: getConversationEventStore } =
  createPortSlot<ConversationEventStore>("ConversationEventStore", "setConversationEventStore");
