/**
 * HeartbeatStore — agent-defined interface for reminder persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

import type { ReminderRow, CreateReminderInput } from "../capabilities/heartbeat/types.js";
import { createPortSlot } from "./slot.js";

export interface HeartbeatStore {
  createReminder(input: CreateReminderInput): Promise<ReminderRow>;

  /** Reminders due at or before `now`, earliest first. */
  findDue(now: Date, limit: number): Promise<ReminderRow[]>;

  /**
   * Delete a reminder and return the deleted row, or null if it was already
   * gone. Deletion is the claim: the tick uses it so only one worker runs a
   * given reminder, and cancel_reminder uses it to drop one. Same operation.
   */
  claimById(reminderId: string): Promise<ReminderRow | null>;

  /** Queued reminders for an account, earliest first. */
  listByAccount(accountId: string): Promise<ReminderRow[]>;
}

export const { set: setHeartbeatStore, get: getHeartbeatStore } =
  createPortSlot<HeartbeatStore>("HeartbeatStore", "setHeartbeatStore");
