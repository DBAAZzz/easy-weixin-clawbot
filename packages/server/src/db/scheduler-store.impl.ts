/**
 * Prisma implementation of SchedulerStore interface from @clawbot/agent.
 */

import type {
  SchedulerStore,
  ScheduledTaskRow,
  ScheduledTaskRunRow,
  CreateTaskInput,
  UpdateTaskInput,
  CreateRunInput,
} from "@clawbot/agent/ports";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "./prisma.js";

function toPrismaJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toTaskRow(task: any): ScheduledTaskRow {
  return {
    id: task.id,
    accountId: task.accountId,
    conversationId: task.conversationId,
    seq: task.seq,
    name: task.name,
    prompt: task.prompt,
    taskKind: task.taskKind ?? "prompt",
    configJson:
      task.configJson && typeof task.configJson === "object" && !Array.isArray(task.configJson)
        ? task.configJson
        : {},
    type: task.type,
    cron: task.cron,
    timezone: task.timezone,
    enabled: task.enabled,
    status: task.status,
    runCount: task.runCount,
    failStreak: task.failStreak,
    lastRunAt: task.lastRunAt,
    nextRunAt: task.nextRunAt,
    lastError: task.lastError,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toRunRow(run: any): ScheduledTaskRunRow {
  return {
    id: run.id,
    taskId: run.taskId,
    status: run.status,
    prompt: run.prompt,
    result: run.result,
    durationMs: run.durationMs,
    error: run.error,
    pushed: run.pushed,
    createdAt: run.createdAt,
  };
}

export class PrismaSchedulerStore implements SchedulerStore {
  async createTask(input: CreateTaskInput): Promise<ScheduledTaskRow> {
    const prisma = getPrisma();
    const last = await prisma.scheduledTask.findFirst({
      where: { accountId: input.accountId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;

    const task = await prisma.scheduledTask.create({
      data: {
        accountId: input.accountId,
        conversationId: input.conversationId,
        seq,
        name: input.name,
        prompt: input.prompt,
        taskKind: input.taskKind ?? "prompt",
        configJson: toPrismaJsonValue(input.configJson ?? {}),
        type: input.type ?? "recurring",
        cron: input.cron,
        timezone: input.timezone ?? "Asia/Shanghai",
      },
    });
    return toTaskRow(task);
  }

  async updateTask(accountId: string, seq: number, input: UpdateTaskInput): Promise<ScheduledTaskRow | null> {
    const task = await this.getTaskBySeq(accountId, seq);
    if (!task) return null;
    const updated = await getPrisma().scheduledTask.update({
      where: { id: task.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
        ...(input.taskKind !== undefined ? { taskKind: input.taskKind } : {}),
        ...(input.configJson !== undefined
          ? { configJson: toPrismaJsonValue(input.configJson) }
          : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.cron !== undefined ? { cron: input.cron } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      },
    });
    return toTaskRow(updated);
  }

  async deleteTask(accountId: string, seq: number): Promise<boolean> {
    const task = await this.getTaskBySeq(accountId, seq);
    if (!task) return false;
    await getPrisma().scheduledTask.delete({ where: { id: task.id } });
    return true;
  }

  async getTaskBySeq(accountId: string, seq: number): Promise<ScheduledTaskRow | null> {
    const task = await getPrisma().scheduledTask.findUnique({
      where: { accountId_seq: { accountId, seq } },
    });
    return task ? toTaskRow(task) : null;
  }

  async getTaskById(id: bigint): Promise<ScheduledTaskRow | null> {
    const task = await getPrisma().scheduledTask.findUnique({ where: { id } });
    return task ? toTaskRow(task) : null;
  }

  async listTasks(accountId: string): Promise<ScheduledTaskRow[]> {
    const tasks = await getPrisma().scheduledTask.findMany({
      where: { accountId },
      orderBy: { seq: "asc" },
    });
    return tasks.map(toTaskRow);
  }

  async listEnabledTasks(): Promise<ScheduledTaskRow[]> {
    const tasks = await getPrisma().scheduledTask.findMany({
      where: { enabled: true },
      orderBy: { id: "asc" },
    });
    return tasks.map(toTaskRow);
  }

  async setTaskStatus(
    id: bigint,
    status: string,
    extra?: { lastRunAt?: Date; nextRunAt?: Date; lastError?: string | null; failStreak?: number; runCount?: { increment: number }; enabled?: boolean },
  ): Promise<void> {
    await getPrisma().scheduledTask.update({
      where: { id },
      data: { status, ...extra },
    });
  }

  async createRun(taskId: bigint, data: CreateRunInput): Promise<ScheduledTaskRunRow> {
    const run = await getPrisma().scheduledTaskRun.create({
      data: { taskId, ...data },
    });
    return toRunRow(run);
  }

  async listRuns(taskId: bigint, limit = 10): Promise<ScheduledTaskRunRow[]> {
    const runs = await getPrisma().scheduledTaskRun.findMany({
      where: { taskId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return runs.map(toRunRow);
  }

  async findUnpushedRuns(
    accountId: string,
    conversationId: string,
  ): Promise<Array<ScheduledTaskRunRow & { task: ScheduledTaskRow }>> {
    const runs = await getPrisma().scheduledTaskRun.findMany({
      where: {
        pushed: false,
        status: "success",
        task: { accountId, conversationId },
      },
      include: { task: true },
      orderBy: { createdAt: "asc" },
    });
    return runs.map((r) => ({
      ...toRunRow(r),
      task: toTaskRow(r.task),
    }));
  }

  async markRunPushed(id: bigint): Promise<void> {
    await getPrisma().scheduledTaskRun.update({
      where: { id },
      data: { pushed: true },
    });
  }
}
