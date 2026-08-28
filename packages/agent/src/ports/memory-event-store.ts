import type {
  AppendMemoryEventInput,
  AppendResult,
  MemoryEvent,
} from "../shared/fact-ledger/contracts.js";
import { createPortSlot } from "./slot.js";

export interface ListMemoryEventsInput {
  accountId: string;
  branch: string;
  afterSeq?: number;
  throughSeq?: number;
  limit: number;
}

export interface MemoryEventStore {
  append(input: AppendMemoryEventInput): Promise<AppendResult<MemoryEvent>>;
  getById(eventId: string): Promise<MemoryEvent | null>;
  listBranch(input: ListMemoryEventsInput): Promise<MemoryEvent[]>;
}

export const { set: setMemoryEventStore, get: getMemoryEventStore } =
  createPortSlot<MemoryEventStore>("MemoryEventStore", "setMemoryEventStore");
