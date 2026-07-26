import { TimeoutError } from "../../shared/errors.js";
import { getChatExecutor } from "../../ports/chat-executor.js";
import { getPushService } from "../../ports/push-service.js";
import { getScheduledTaskHandler } from "../../ports/scheduled-task-handler.js";
import {
  getSchedulerStore,
  type RunStatus,
  type ScheduledTaskRow,
} from "../../ports/scheduler-store.js";
import { PROMPT_TASK_KIND, schedulerConversationId } from "./constants.js";

const EXECUTION_TIMEOUT_MS = 60_000;
const MAX_FAIL_STREAK = 3;

/**
 * Run `fn` under a deadline, aborting the signal it was given when the deadline
 * passes.
 *
 * Both task paths (LLM chat and native handlers) go through here so a timeout
 * actually cancels the work. Rejecting the promise alone is not enough: the
 * underlying run would keep calling the LLM, keep writing to the shared
 * conversation history, and keep queueing persistence long after the executor
 * has recorded the task as timed out.
 */
async function runWithDeadline<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const work = fn(controller.signal);
    // When the deadline wins the race below, nothing is left observing `work`.
    // This no-op catch keeps its eventual rejection from surfacing as an
    // unhandled one; rejections arriving before the deadline are still returned
    // by the race itself, so no error is swallowed here.
    void work.catch(() => {});

    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(`${label} timed out`));
      }, timeoutMs);
    });

    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runChatTask(
  task: ScheduledTaskRow,
  executionConvId: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const execResult = await getChatExecutor().execute({
    accountId: task.accountId,
    conversationId: executionConvId,
    targetConversationId: task.conversationId,
    prompt: task.prompt,
    runKind: "scheduler",
    signal,
  });

  if (execResult.status === "error") {
    throw new Error(execResult.error ?? "chat executor failed");
  }

  return execResult.text ?? undefined;
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
      const handlerResult = await runWithDeadline(
        `Scheduled task #${task.seq}`,
        EXECUTION_TIMEOUT_MS,
        (signal) => getScheduledTaskHandler().execute(task, { signal }),
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
      result = await runWithDeadline(
        `Scheduled task #${task.seq}`,
        EXECUTION_TIMEOUT_MS,
        (signal) => runChatTask(task, executionConvId, signal),
      );

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
