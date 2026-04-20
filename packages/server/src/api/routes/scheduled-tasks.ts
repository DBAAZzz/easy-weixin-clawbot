import type { Hono } from "hono";
import { getSchedulerStore } from "@clawbot/agent/ports";
import type { ScheduledTaskRow, ScheduledTaskRunRow } from "@clawbot/agent/ports";
import { schedulerManager } from "@clawbot/agent";
import { createModuleLogger, getErrorFields } from "../../logger.js";

export interface ScheduledTaskDto {
  id: string;
  seq: number;
  accountId: string;
  conversationId: string;
  name: string;
  prompt: string;
  type: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  status: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  runCount: number;
  failStreak: number;
}

export interface ScheduledTaskRunDto {
  id: string;
  status: string;
  prompt: string;
  result: string | null;
  durationMs: number | null;
  error: string | null;
  pushed: boolean;
  createdAt: string;
}

const scheduledTaskLogger = createModuleLogger("scheduled-tasks");

function toTaskDto(task: ScheduledTaskRow): ScheduledTaskDto {
  return {
    id: task.id.toString(),
    seq: task.seq,
    accountId: task.accountId,
    conversationId: task.conversationId,
    name: task.name,
    prompt: task.prompt,
    type: task.type,
    cron: task.cron,
    timezone: task.timezone,
    enabled: task.enabled,
    status: task.status,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    lastError: task.lastError,
    runCount: task.runCount,
    failStreak: task.failStreak,
  };
}

function toRunDto(run: ScheduledTaskRunRow): ScheduledTaskRunDto {
  return {
    id: run.id.toString(),
    status: run.status,
    prompt: run.prompt,
    result: run.result,
    durationMs: run.durationMs,
    error: run.error,
    pushed: run.pushed,
    createdAt: run.createdAt.toISOString(),
  };
}

export function registerScheduledTaskRoutes(app: Hono) {
  // List all scheduled tasks (with optional account filter)
  app.get("/api/scheduled-tasks", async (c) => {
    const accountId = c.req.query("accountId");
    const store = getSchedulerStore();

    try {
      let tasks: ScheduledTaskRow[];

      if (accountId) {
        tasks = await store.listTasks(accountId);
      } else {
        // Get all tasks via Prisma directly (no port method for listing all)
        const { getPrisma } = await import("../../db/prisma.js");
        const rows = await getPrisma().scheduledTask.findMany({
          orderBy: { createdAt: "desc" },
        });
        tasks = rows as unknown as ScheduledTaskRow[];
      }

      return c.json({ data: tasks.map(toTaskDto) });
    } catch (error) {
      scheduledTaskLogger.error(
        { ...getErrorFields(error), accountId: accountId ?? null },
        "获取定时任务列表失败",
      );
      return c.json({ error: "Failed to list scheduled tasks" }, 500);
    }
  });

  // Get a single task by account + seq
  app.get("/api/scheduled-tasks/:accountId/:seq", async (c) => {
    const accountId = c.req.param("accountId");
    const seq = parseInt(c.req.param("seq"), 10);

    if (Number.isNaN(seq)) {
      return c.json({ error: "Invalid seq parameter" }, 400);
    }

    try {
      const store = getSchedulerStore();
      const task = await store.getTaskBySeq(accountId, seq);
      if (!task) {
        return c.json({ error: "Task not found" }, 404);
      }

      return c.json({ data: toTaskDto(task) });
    } catch (error) {
      scheduledTaskLogger.error(
        { ...getErrorFields(error), accountId, seq },
        "获取定时任务详情失败",
      );
      return c.json({ error: "Failed to get scheduled task" }, 500);
    }
  });

  // Toggle task enabled state
  app.patch("/api/scheduled-tasks/:accountId/:seq", async (c) => {
    const accountId = c.req.param("accountId");
    const seq = parseInt(c.req.param("seq"), 10);

    if (Number.isNaN(seq)) {
      return c.json({ error: "Invalid seq parameter" }, 400);
    }

    try {
      const body = await c.req.json<{ enabled?: boolean }>();
      if (typeof body.enabled !== "boolean") {
        return c.json({ error: "Missing or invalid 'enabled' field" }, 400);
      }

      const store = getSchedulerStore();
      const task = await store.getTaskBySeq(accountId, seq);
      if (!task) {
        return c.json({ error: "Task not found" }, 404);
      }

      const updated = await store.updateTask(accountId, seq, { enabled: body.enabled });
      if (!updated) {
        return c.json({ error: "Failed to update task" }, 500);
      }

      if (updated.enabled) {
        schedulerManager.activate(updated);
      } else {
        schedulerManager.deactivate(updated.id);
      }

      return c.json({ data: toTaskDto(updated) });
    } catch (error) {
      scheduledTaskLogger.error(
        { ...getErrorFields(error), accountId, seq },
        "更新定时任务失败",
      );
      return c.json({ error: "Failed to update scheduled task" }, 500);
    }
  });

  // List runs for a task
  app.get("/api/scheduled-tasks/:accountId/:seq/runs", async (c) => {
    const accountId = c.req.param("accountId");
    const seq = parseInt(c.req.param("seq"), 10);
    const limit = parseInt(c.req.query("limit") ?? "20", 10);

    if (Number.isNaN(seq)) {
      return c.json({ error: "Invalid seq parameter" }, 400);
    }

    try {
      const store = getSchedulerStore();
      const task = await store.getTaskBySeq(accountId, seq);
      if (!task) {
        return c.json({ error: "Task not found" }, 404);
      }

      const runs = await store.listRuns(task.id, limit);
      return c.json({ data: runs.map(toRunDto) });
    } catch (error) {
      scheduledTaskLogger.error(
        { ...getErrorFields(error), accountId, seq, limit },
        "获取定时任务运行记录失败",
      );
      return c.json({ error: "Failed to list task runs" }, 500);
    }
  });
}
