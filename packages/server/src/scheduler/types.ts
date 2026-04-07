import type { ScheduledTask, ScheduledTaskRun } from "@prisma/client";

export type { ScheduledTask, ScheduledTaskRun };

export type TaskType = "once" | "recurring";
export type TaskStatus = "idle" | "running" | "error" | "paused";
export type RunStatus = "success" | "error" | "timeout" | "skipped";

export interface CreateTaskInput {
  accountId: string;
  conversationId: string;
  name: string;
  prompt: string;
  type?: TaskType;
  cron: string;
  timezone?: string;
}

export interface UpdateTaskInput {
  name?: string;
  prompt?: string;
  type?: TaskType;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
}
