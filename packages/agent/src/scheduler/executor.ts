import { chat } from "../chat.js";
import { TimeoutError } from "../errors.js";
import { withTimeout } from "../utils/async.js";
import { withConversationLock } from "../conversation/history.js";
import { getPushService } from "../ports/push-service.js";
import { getScheduledTaskHandler } from "../ports/scheduled-task-handler.js";
import {
  getSchedulerStore,
  type RunStatus,
  type ScheduledTaskRow,
} from "../ports/scheduler-store.js";
import { PROMPT_TASK_KIND, schedulerConversationId } from "./constants.js";

const EXECUTION_TIMEOUT_MS = 60_000;
const MAX_FAIL_STREAK = 3;

async function runChatTaskWithTimeout(
  task: ScheduledTaskRow,
  executionConvId: string,
): Promise<string | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const chatPromise = withConversationLock(task.accountId, executionConvId, () =>
      chat(task.accountId, executionConvId, task.prompt, undefined, Date.now(), {
        signal: controller.signal,
        toolContext: {
          accountId: task.accountId,
          conversationId: executionConvId,
          targetConversationId: task.conversationId,
          runKind: "scheduler",
        },
      }),
    );
    void chatPromise.catch(() => {});

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(`Scheduled task #${task.seq} timed out`));
      }, EXECUTION_TIMEOUT_MS);
    });
    const chatResult = await Promise.race([chatPromise, timeoutPromise]);

    return chatResult.text ?? undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Execute a scheduled task:
 * 1. Call chat() with the task's prompt in an isolated conversation context
 * 2. Push the result to the target conversation
 * 3. Record the run in DB
 */
export async function executeTask(task: ScheduledTaskRow): Promise<void> {
  const startedAt = Date.now();
  const store = getSchedulerStore();

  // Mark task as running
  await store.setTaskStatus(task.id, "running");

  // Use isolated conversation context: "scheduler:{seq}"
  const executionConvId = schedulerConversationId(task.seq);

  let result: string | undefined;
  let error: string | undefined;
  let status: RunStatus = "success";
  let pushed = false;

  try {
    // 走RRS订阅定时任务
    if (task.taskKind !== PROMPT_TASK_KIND) {
      const handlerResult = await withTimeout(
        getScheduledTaskHandler().execute(task),
        EXECUTION_TIMEOUT_MS,
      );

      if (!handlerResult) {
        throw new Error(`No scheduled task handler for kind ${task.taskKind}`);
      }

      result = handlerResult.result;
      error = handlerResult.error;
      status = handlerResult.status;
      pushed = handlerResult.pushed;
    } else {
      // Execute AI chat with timeout
      result = await runChatTaskWithTimeout(task, executionConvId);

      // Try to push the result
      if (result) {
        try {
          const pushService = getPushService();
          await pushService.sendProactiveMessage(task.accountId, task.conversationId, result);
          pushed = true;
        } catch (pushErr) {
          console.warn(
            `[scheduler] push failed for task #${task.seq} (${task.accountId}): ${(pushErr as Error).message}`,
          );
        }
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    error = msg;
    status = err instanceof TimeoutError ? "timeout" : "error";
    console.error(`[scheduler] task #${task.seq} (${task.accountId}) failed: ${msg}`);
  }

  const durationMs = Date.now() - startedAt;

  // Record the run
  await store.createRun(task.id, {
    status,
    prompt: task.prompt,
    result,
    durationMs,
    error,
    pushed,
  });

  // Update task state
  const isFailure = status !== "success";
  const newFailStreak = isFailure ? task.failStreak + 1 : 0;
  const shouldPause = newFailStreak >= MAX_FAIL_STREAK;

  // Once-type tasks: auto-disable after execution
  const isOnce = task.type === "once";

  await store.setTaskStatus(task.id, isOnce ? "idle" : shouldPause ? "paused" : "idle", {
    lastRunAt: new Date(),
    lastError: isFailure ? error : null,
    failStreak: newFailStreak,
    runCount: { increment: 1 },
    ...(isOnce ? { enabled: false } : {}),
  });

  if (isOnce) {
    // Lazy import to avoid circular dependency (manager → executor → manager)
    const { deactivate } = await import("./manager.js");
    deactivate(task.id);
    console.log(
      `[scheduler] once-task #${task.seq} (${task.accountId}) completed and auto-disabled`,
    );
  } else if (shouldPause) {
    console.warn(
      `[scheduler] task #${task.seq} (${task.accountId}) auto-paused after ${MAX_FAIL_STREAK} consecutive failures`,
    );
  }
}
