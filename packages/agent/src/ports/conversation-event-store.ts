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
}

export const { set: setConversationEventStore, get: getConversationEventStore } =
  createPortSlot<ConversationEventStore>("ConversationEventStore", "setConversationEventStore");
