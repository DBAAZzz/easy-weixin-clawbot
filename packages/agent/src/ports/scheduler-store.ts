/**
 * SchedulerStore — agent-defined interface for scheduled task persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

export interface ScheduledTaskRow {
  id: bigint;
  accountId: string;
  conversationId: string;
  seq: number;
  name: string;
  prompt: string;
  taskKind: "prompt" | "rss_digest" | "rss_brief";
  configJson: Record<string, unknown>;
  type: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  status: string;
  runCount: number;
  failStreak: number;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledTaskRunRow {
  id: bigint;
  taskId: bigint;
  status: string;
  prompt: string;
  result: string | null;
  durationMs: number | null;
  error: string | null;
  pushed: boolean;
  createdAt: Date;
}

export interface CreateTaskInput {
  accountId: string;
  conversationId: string;
  name: string;
  prompt: string;
  taskKind?: ScheduledTaskRow["taskKind"];
  configJson?: Record<string, unknown>;
  type?: string;
  cron: string;
  timezone?: string;
}

export interface UpdateTaskInput {
  name?: string;
  prompt?: string;
  taskKind?: ScheduledTaskRow["taskKind"];
  configJson?: Record<string, unknown>;
  type?: string;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
}

export type RunStatus = "success" | "error" | "timeout" | "skipped";

export interface CreateRunInput {
  status: RunStatus;
  prompt: string;
  result?: string;
  durationMs?: number;
  error?: string;
  pushed: boolean;
}

export interface SchedulerStore {
  createTask(input: CreateTaskInput): Promise<ScheduledTaskRow>;
  updateTask(accountId: string, seq: number, input: UpdateTaskInput): Promise<ScheduledTaskRow | null>;
  deleteTask(accountId: string, seq: number): Promise<boolean>;
  getTaskBySeq(accountId: string, seq: number): Promise<ScheduledTaskRow | null>;
  getTaskById(id: bigint): Promise<ScheduledTaskRow | null>;
  listTasks(accountId: string): Promise<ScheduledTaskRow[]>;
  listEnabledTasks(): Promise<ScheduledTaskRow[]>;
  setTaskStatus(
    id: bigint,
    status: string,
    extra?: {
      lastRunAt?: Date;
      nextRunAt?: Date;
      lastError?: string | null;
      failStreak?: number;
      runCount?: { increment: number };
      enabled?: boolean;
    },
  ): Promise<void>;
  createRun(taskId: bigint, data: CreateRunInput): Promise<ScheduledTaskRunRow>;
  listRuns(taskId: bigint, limit?: number): Promise<ScheduledTaskRunRow[]>;
  findUnpushedRuns(accountId: string, conversationId: string): Promise<Array<ScheduledTaskRunRow & { task: ScheduledTaskRow }>>;
  markRunPushed(id: bigint): Promise<void>;
}

let store: SchedulerStore | null = null;

export function setSchedulerStore(impl: SchedulerStore): void {
  store = impl;
}

export function getSchedulerStore(): SchedulerStore {
  if (!store) throw new Error("SchedulerStore not initialized — call setSchedulerStore() at startup");
  return store;
}
