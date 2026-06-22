/**
 * HeartbeatStore — agent-defined interface for pending goal persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

import type {
  GoalStatus,
  PendingGoalRow,
  CreateGoalInput,
  UpdateGoalInput,
} from "../heartbeat/types.js";
import { createPortSlot } from "./slot.js";

export interface HeartbeatStore {
  // ── CRUD ──
  createGoal(input: CreateGoalInput): Promise<PendingGoalRow>;
  getByGoalId(goalId: string): Promise<PendingGoalRow | null>;
  updateGoal(goalId: string, updates: UpdateGoalInput): Promise<void>;

  // ── Queries ──
  findDueGoals(now: Date): Promise<PendingGoalRow[]>;
  findByAccountAndStatus(
    accountId: string,
    conversationId: string,
    status: GoalStatus,
  ): Promise<PendingGoalRow[]>;
  countActiveGoals(accountId: string): Promise<number>;
  findSimilarGoal(
    accountId: string,
    conversationId: string,
    description: string,
  ): Promise<PendingGoalRow | null>;
  listGoals(accountId: string, includeTerminal?: boolean): Promise<PendingGoalRow[]>;

  // ── Events ──
  markUserReplied(goalId: string, messageSeq: number): Promise<void>;
  processResumeSignals(now: Date): Promise<number>;

  // ── Lifecycle ──
  abandonExpired(now: Date): Promise<number>;
}

export const { set: setHeartbeatStore, get: getHeartbeatStore } =
  createPortSlot<HeartbeatStore>("HeartbeatStore", "setHeartbeatStore");
