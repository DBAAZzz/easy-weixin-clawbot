import type {
  AgentRunEvent,
  AppendAgentRunEventInput,
  AppendResult,
} from "../shared/fact-ledger/contracts.js";
import { createPortSlot } from "./slot.js";

export interface ListAgentRunEventsInput {
  runId: string;
  afterSeq?: number;
  throughSeq?: number;
  limit: number;
}

export interface AgentRunStore {
  append(input: AppendAgentRunEventInput): Promise<AppendResult<AgentRunEvent>>;
  getById(eventId: string): Promise<AgentRunEvent | null>;
  listRun(input: ListAgentRunEventsInput): Promise<AgentRunEvent[]>;
}

export const { set: setAgentRunStore, get: getAgentRunStore } = createPortSlot<AgentRunStore>(
  "AgentRunStore",
  "setAgentRunStore",
);
