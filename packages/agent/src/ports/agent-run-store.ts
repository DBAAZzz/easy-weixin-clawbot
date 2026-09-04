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

export interface ListRunEventsByStreamInput {
  accountId: string;
  conversationStreamId: string;
  limit: number;
  /**
   * Keyset cursor: the (recordedAt, eventId) of the last row of the previous
   * page. Ordering is `(recorded_at asc, event_id asc)`, matching the
   * `idx_agent_run_events_conversation` index.
   */
  after?: { recordedAt: string; eventId: string };
}

export interface AgentRunStore {
  append(input: AppendAgentRunEventInput): Promise<AppendResult<AgentRunEvent>>;
  getById(eventId: string): Promise<AgentRunEvent | null>;
  listRun(input: ListAgentRunEventsInput): Promise<AgentRunEvent[]>;
  /** Aggregate run-event page for one canonical stream; the run-facts reducer groups by runId. */
  listRunEventsByStream(input: ListRunEventsByStreamInput): Promise<AgentRunEvent[]>;
}

export const { set: setAgentRunStore, get: getAgentRunStore } = createPortSlot<AgentRunStore>(
  "AgentRunStore",
  "setAgentRunStore",
);
