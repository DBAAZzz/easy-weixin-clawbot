export interface ReminderRow {
  id: bigint;
  reminderId: string;
  accountId: string;
  /** Real conversation — reminders run in the user's own session. */
  conversationId: string;
  prompt: string;
  fireAt: Date;
  createdAt: Date;
}

export interface CreateReminderInput {
  accountId: string;
  conversationId: string;
  prompt: string;
  fireAt: Date;
}

/** Max reminders one account may have queued at once. */
export const MAX_PENDING_PER_ACCOUNT = 20;

/** How far ahead a reminder may be scheduled. */
export const MAX_FIRE_AHEAD_MS = 7 * 24 * 3600_000;

/** Max due reminders processed per tick. Unrelated to MAX_PENDING_PER_ACCOUNT. */
export const TICK_BATCH_SIZE = 20;
