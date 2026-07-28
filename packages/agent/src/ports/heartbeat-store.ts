/**
 * HeartbeatStore — agent-defined interface for conversation pulse persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

import type { PulseRow, PulseUpdate } from "../capabilities/heartbeat/types.js";
import { createPortSlot } from "./slot.js";

export interface HeartbeatStore {
  /**
   * Record that the user just spoke: create the pulse row if absent, and push
   * the next evaluation out — someone who just talked to you does not need to
   * be pinged.
   */
  notePulseActivity(
    accountId: string,
    conversationId: string,
    now: Date,
    nextEvalAt: Date,
  ): Promise<void>;

  /** Pulses due for evaluation at or before `now`, earliest first. */
  findDuePulses(now: Date, limit: number): Promise<PulseRow[]>;

  /**
   * Optimistically claim a pulse for evaluation by pushing nextEvalAt forward,
   * but only if it still holds `expectedNextEvalAt`. Returns false when another
   * worker got there first. Pulse rows are long-lived, so unlike a reminder
   * this cannot be a delete.
   */
  claimForEval(id: bigint, expectedNextEvalAt: Date, deferTo: Date): Promise<boolean>;

  /** Write back the outcome of an evaluation. */
  applyVerdict(id: bigint, updates: PulseUpdate): Promise<void>;
}

export const { set: setHeartbeatStore, get: getHeartbeatStore } =
  createPortSlot<HeartbeatStore>("HeartbeatStore", "setHeartbeatStore");
