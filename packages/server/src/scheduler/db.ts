import { getPrisma } from "../db/prisma.js";
import type { CreateTaskInput, UpdateTaskInput, ScheduledTask, ScheduledTaskRun, RunStatus } from "./types.js";

/** Get the next seq number for an account's tasks. */
async function nextSeq(accountId: string): Promise<number> {
  const last = await getPrisma().scheduledTask.findFirst({
    where: { accountId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return (last?.seq ?? 0) + 1;
}

export async function createTask(input: CreateTaskInput): Promise<ScheduledTask> {
  const seq = await nextSeq(input.accountId);
  return getPrisma().scheduledTask.create({
    data: {
      accountId: input.accountId,
      conversationId: input.conversationId,
      seq,
      name: input.name,
      prompt: input.prompt,
      cron: input.cron,
      timezone: input.timezone ?? "Asia/Shanghai",
    },
  });
}

export async function updateTask(
  accountId: string,
  seq: number,
  input: UpdateTaskInput,
): Promise<ScheduledTask | null> {
  const task = await getTaskBySeq(accountId, seq);
  if (!task) return null;
  return getPrisma().scheduledTask.update({
    where: { id: task.id },
    data: input,
  });
}

export async function deleteTask(accountId: string, seq: number): Promise<boolean> {
  const task = await getTaskBySeq(accountId, seq);
  if (!task) return false;
  await getPrisma().scheduledTask.delete({ where: { id: task.id } });
  return true;
}

export async function getTaskBySeq(accountId: string, seq: number): Promise<ScheduledTask | null> {
  return getPrisma().scheduledTask.findUnique({
    where: { accountId_seq: { accountId, seq } },
  });
}

export async function getTaskById(id: bigint): Promise<ScheduledTask | null> {
  return getPrisma().scheduledTask.findUnique({ where: { id } });
}

export async function listTasks(accountId: string): Promise<ScheduledTask[]> {
  return getPrisma().scheduledTask.findMany({
    where: { accountId },
    orderBy: { seq: "asc" },
  });
}

export async function listEnabledTasks(): Promise<ScheduledTask[]> {
  return getPrisma().scheduledTask.findMany({
    where: { enabled: true },
    orderBy: { id: "asc" },
  });
}

export async function setTaskStatus(
  id: bigint,
  status: string,
  extra?: { lastRunAt?: Date; nextRunAt?: Date; lastError?: string | null; failStreak?: number; runCount?: { increment: number } },
): Promise<void> {
  await getPrisma().scheduledTask.update({
    where: { id },
    data: { status, ...extra },
  });
}

export async function createRun(
  taskId: bigint,
  data: { status: RunStatus; prompt: string; result?: string; durationMs?: number; error?: string; pushed: boolean },
): Promise<ScheduledTaskRun> {
  return getPrisma().scheduledTaskRun.create({
    data: { taskId, ...data },
  });
}

export async function listRuns(taskId: bigint, limit = 10): Promise<ScheduledTaskRun[]> {
  return getPrisma().scheduledTaskRun.findMany({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Find runs that were not pushed for a given account+conversation. */
export async function findUnpushedRuns(
  accountId: string,
  conversationId: string,
): Promise<(ScheduledTaskRun & { task: ScheduledTask })[]> {
  return getPrisma().scheduledTaskRun.findMany({
    where: {
      pushed: false,
      status: "success",
      task: { accountId, conversationId },
    },
    include: { task: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function markRunPushed(id: bigint): Promise<void> {
  await getPrisma().scheduledTaskRun.update({
    where: { id },
    data: { pushed: true },
  });
}
