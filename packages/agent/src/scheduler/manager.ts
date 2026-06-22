import { schedule, validate, type ScheduledTask as CronTask } from "node-cron";
import { createLogger } from "@clawbot/observability";
import { getSchedulerStore, type ScheduledTaskRow } from "../ports/scheduler-store.js";
import { executeTask } from "./executor.js";

const logger = createLogger({ component: "scheduler.manager" });

/** Missed-tick recovery window: only compensate if within this many ms. */
const MISSED_TICK_WINDOW_MS = 30 * 60 * 1000;

/**
 * Map of active cron jobs, keyed by task DB id (bigint → string).
 * Stores both the cron task and a running flag to prevent concurrent execution.
 */
const activeJobs = new Map<string, { job: CronTask; running: boolean }>();

function taskKey(id: bigint): string {
  return id.toString();
}

/** Activate a single task: register its cron job. */
export function activate(task: ScheduledTaskRow): void {
  const key = taskKey(task.id);

  // Deactivate existing job if any
  deactivate(task.id);

  if (!validate(task.cron)) {
    logger.error("invalid cron expression", { seq: task.seq, cron: task.cron });
    return;
  }

  const entry = { job: null as unknown as CronTask, running: false };

  entry.job = schedule(
    task.cron,
    async () => {
      if (entry.running) {
        logger.info("task still running, skipping tick", { seq: task.seq });
        return;
      }

      entry.running = true;
      try {
        const store = getSchedulerStore();
        // Re-fetch task to get latest state (might have been paused/disabled)
        const current = await store.getTaskById(task.id);
        if (!current || !current.enabled || current.status === "paused") {
          return;
        }
        await executeTask(current);
      } catch (err) {
        logger.error("unexpected task error", { seq: task.seq, error: err });
      } finally {
        entry.running = false;
      }
    },
    {
      timezone: task.timezone,
    },
  );

  activeJobs.set(key, entry);
  logger.info("activated task", { seq: task.seq, name: task.name, cron: task.cron });
}

/** Deactivate a task's cron job. */
export function deactivate(id: bigint): void {
  const key = taskKey(id);
  const entry = activeJobs.get(key);
  if (entry) {
    entry.job.stop();
    activeJobs.delete(key);
  }
}

/**
 * Bootstrap: load all enabled tasks from DB, register cron jobs,
 * and compensate for missed ticks during downtime.
 */
export async function bootstrap(): Promise<void> {
  const store = getSchedulerStore();
  const tasks = await store.listEnabledTasks();

  if (tasks.length === 0) {
    logger.info("no enabled tasks found");
    return;
  }

  for (const task of tasks) {
    if (task.status === "paused") continue;

    activate(task);

    // Missed-tick recovery
    if (task.nextRunAt && task.lastRunAt) {
      const now = Date.now();
      const nextRunTime = task.nextRunAt.getTime();
      const lastRunTime = task.lastRunAt.getTime();

      if (nextRunTime < now && lastRunTime < nextRunTime) {
        const missedBy = now - nextRunTime;
        if (missedBy <= MISSED_TICK_WINDOW_MS) {
          logger.info("compensating missed tick", {
            seq: task.seq,
            missedBySeconds: Math.round(missedBy / 1000),
          });
          void executeTask(task).catch((err) =>
            logger.error("compensation execution failed", { seq: task.seq, error: err }),
          );
        } else {
          logger.info("skipping missed tick beyond recovery window", {
            seq: task.seq,
            missedByMinutes: Math.round(missedBy / 60000),
          });
        }
      }
    }
  }

  logger.info("bootstrapped tasks", { count: tasks.length });
}

/** Shutdown: stop all cron jobs and wait for running tasks to finish. */
export async function shutdown(): Promise<void> {
  const entries = [...activeJobs.values()];

  for (const entry of entries) {
    entry.job.stop();
  }

  // Wait for running tasks (with timeout)
  const MAX_WAIT = 10_000;
  const start = Date.now();
  while (entries.some((e) => e.running) && Date.now() - start < MAX_WAIT) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  activeJobs.clear();
  logger.info("shutdown complete");
}

export const schedulerManager = {
  bootstrap,
  activate,
  deactivate,
  shutdown,
};
