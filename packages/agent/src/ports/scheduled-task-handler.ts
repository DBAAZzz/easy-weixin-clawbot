import type { RunStatus, ScheduledTaskRow } from "./scheduler-store.js";

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

let handler: ScheduledTaskHandlerPort | null = null;

export function setScheduledTaskHandler(impl: ScheduledTaskHandlerPort): void {
  handler = impl;
}

export function getScheduledTaskHandler(): ScheduledTaskHandlerPort {
  if (!handler) {
    throw new Error("ScheduledTaskHandlerPort not initialized — call setScheduledTaskHandler() at startup");
  }

  return handler;
}