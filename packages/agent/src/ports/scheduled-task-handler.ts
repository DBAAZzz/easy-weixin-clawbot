import type { RunStatus, ScheduledTaskRow } from "./scheduler-store.js";
import { createPortSlot } from "./slot.js";

export interface ScheduledTaskHandlerResult {
  status: RunStatus;
  prompt: string;
  result?: string;
  error?: string;
  pushed: boolean;
}

export interface ScheduledTaskHandlerPort {
  execute(task: ScheduledTaskRow): Promise<ScheduledTaskHandlerResult | null>;
}

export const { set: setScheduledTaskHandler, get: getScheduledTaskHandler } =
  createPortSlot<ScheduledTaskHandlerPort>("ScheduledTaskHandlerPort", "setScheduledTaskHandler");
