import { schedule, validate, type ScheduledTask as CronTask } from "node-cron";
import { listEnabledTasks, getTaskById } from "./db.js";
import { executeTask } from "./executor.js";
import type { ScheduledTask } from "./types.js";

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
export function activate(task: ScheduledTask): void {
  const key = taskKey(task.id);

  // Deactivate existing job if any
  deactivate(task.id);

  if (!validate(task.cron)) {
    console.error(`[scheduler] invalid cron expression for task #${task.seq}: "${task.cron}"`);
    return;
  }

  const entry = { job: null as unknown as CronTask, running: false };

  entry.job = schedule(
    task.cron,
    async () => {
      if (entry.running) {
        console.log(`[scheduler] task #${task.seq} still running, skipping tick`);
        return;
      }

      entry.running = true;
      try {
        // Re-fetch task to get latest state (might have been paused/disabled)
        const current = await getTaskById(task.id);
        if (!current || !current.enabled || current.status === "paused") {
          return;
        }
        await executeTask(current);
      } catch (err) {
        console.error(`[scheduler] unexpected error in task #${task.seq}:`, err);
      } finally {
        entry.running = false;
      }
    },
    {
      timezone: task.timezone,
    },
  );

  activeJobs.set(key, entry);
  console.log(`[scheduler] activated task #${task.seq} "${task.name}" [${task.cron}]`);
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
  const tasks = await listEnabledTasks();

  if (tasks.length === 0) {
    console.log("[scheduler] no enabled tasks found");
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
          console.log(
            `[scheduler] compensating missed tick for task #${task.seq} (missed by ${Math.round(missedBy / 1000)}s)`,
          );
          // Fire-and-forget compensation execution
          void executeTask(task).catch((err) =>
            console.error(`[scheduler] compensation execution failed for task #${task.seq}:`, err),
          );
        } else {
          console.log(
            `[scheduler] skipping missed tick for task #${task.seq} (missed by ${Math.round(missedBy / 60000)}min, beyond window)`,
          );
        }
      }
    }
  }

  console.log(`[scheduler] bootstrapped ${tasks.length} task(s)`);
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
  console.log("[scheduler] shutdown complete");
}

export const schedulerManager = {
  bootstrap,
  activate,
  deactivate,
  shutdown,
};
