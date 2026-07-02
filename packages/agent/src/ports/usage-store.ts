/**
 * UsageStore — agent-defined interface for per-call token usage metering.
 *
 * A sibling sink to MessageStore, written from the chat persistence path and
 * fully decoupled from the observability sampling pipeline. Implemented by
 * server (Prisma) and injected at startup.
 */

import { createPortSlot } from "./slot.js";

export interface RecordUsageParams {
  accountId: string;
  conversationId: string;
  /** Request-level id for activity de-duplication; the current trace id. */
  requestId: string;
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStore {
  /** Async, batched, fire-and-forget — must not block the conversation path. */
  queueRecord(params: RecordUsageParams): void;
}

export const { set: setUsageStore, get: getUsageStore } =
  createPortSlot<UsageStore>("UsageStore", "setUsageStore");
