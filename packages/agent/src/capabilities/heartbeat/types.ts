/**
 * Pulse — a conversation's proactive rhythm.
 *
 * Deliberately holds no instruction. What to say is decided at evaluation
 * time from memory, not registered in advance; storing a prompt here would
 * make this a scheduler.
 */
export interface PulseRow {
  id: bigint;
  accountId: string;
  conversationId: string;
  nextEvalAt: Date;
  /** Last time the user said something. */
  lastUserAt: Date | null;
  /** Last time the agent spoke unprompted. */
  lastSpokeAt: Date | null;
  /** Consecutive evaluations that decided to stay quiet. Drives backoff. */
  quietStreak: number;
  /** Local date (Asia/Shanghai, YYYY-MM-DD) that spokenToday refers to. */
  spokenDateKey: string | null;
  spokenToday: number;
}

export interface PulseUpdate {
  nextEvalAt: Date;
  quietStreak: number;
  lastSpokeAt?: Date;
  spokenDateKey?: string;
  spokenToday?: number;
}

/** What the evaluator model returns, after parsing. */
export interface PulseVerdict {
  speak: boolean;
  reason: string;
  prompt: string | null;
  nextEvalInMinutes: number;
}

/** Final decision after hard constraints are applied to a verdict. */
export interface PulseDecision {
  speak: boolean;
  prompt: string | null;
  nextEvalAt: Date;
  /** Set when a hard constraint overrode a speak verdict. */
  blockedBy?: string;
}

export const PULSE_TIMEZONE = "Asia/Shanghai";

/** Floor and ceiling for the model's requested re-evaluation delay. */
export const PULSE_MIN_MINUTES = 30;
export const PULSE_MAX_MINUTES = 1440;

/** Quiet window [start, end) in PULSE_TIMEZONE — never speak inside it. */
export const PULSE_QUIET_START_HOUR = 23;
export const PULSE_QUIET_END_HOUR = 8;

/** Max proactive messages per conversation per local day. */
export const PULSE_MAX_PER_DAY = 3;

/** Minimum gap between two proactive messages. */
export const PULSE_MIN_GAP_MINUTES = 4 * 60;

/** Cap on the exponential backoff multiplier (48 × 30min = 24h). */
export const PULSE_MAX_BACKOFF_STEPS = 48;

/** Max pulses evaluated per tick. */
export const PULSE_TICK_BATCH_SIZE = 20;

/** Fallback delay when the evaluator's output cannot be parsed. */
export const PULSE_PARSE_FAILURE_MINUTES = 240;
