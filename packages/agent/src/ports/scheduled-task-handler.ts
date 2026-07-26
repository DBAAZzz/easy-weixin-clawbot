import type { RunStatus, ScheduledTaskRow } from "./scheduler-store.js";
import { createPortSlot } from "./slot.js";

export interface ScheduledTaskHandlerResult {
  status: RunStatus;
  prompt: string;
  result?: string;
  error?: string;
  pushed: boolean;
}

export interface ScheduledTaskExecutionContext {
  /**
   * Aborted when the executor's deadline passes. Handlers are expected to check
   * it before any irreversible step (pushing a message, marking rows delivered)
   * and to forward it to the IO they perform, so that a timeout cancels the work
   * instead of leaving it running unobserved.
   */
  signal: AbortSignal;
}

export interface ScheduledTaskHandlerPort {
  execute(
    task: ScheduledTaskRow,
    ctx: ScheduledTaskExecutionContext,
  ): Promise<ScheduledTaskHandlerResult | null>;
}

export const { set: setScheduledTaskHandler, get: getScheduledTaskHandler } =
  createPortSlot<ScheduledTaskHandlerPort>("ScheduledTaskHandlerPort", "setScheduledTaskHandler");
