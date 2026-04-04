import { chat } from "../ai.js";
import { sendProactiveMessage } from "../proactive-push.js";
import { createRun, setTaskStatus } from "./db.js";
import type { ScheduledTask } from "./types.js";

const EXECUTION_TIMEOUT_MS = 60_000;
const MAX_FAIL_STREAK = 3;

/**
 * Execute a scheduled task:
 * 1. Call chat() with the task's prompt in an isolated conversation context
 * 2. Push the result to the target conversation
 * 3. Record the run in DB
 */
export async function executeTask(task: ScheduledTask): Promise<void> {
  const startedAt = Date.now();

  // Mark task as running
  await setTaskStatus(task.id, "running");

  // Use isolated conversation context: "scheduler:{seq}"
  const executionConvId = `scheduler:${task.seq}`;

  let result: string | undefined;
  let error: string | undefined;
  let status: "success" | "error" | "timeout" = "success";
  let pushed = false;

  try {
    // Execute AI chat with timeout
    const chatResult = await Promise.race([
      chat(task.accountId, executionConvId, task.prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Execution timeout")), EXECUTION_TIMEOUT_MS),
      ),
    ]);

    result = chatResult.text ?? undefined;

    // Try to push the result
    if (result) {
      try {
        await sendProactiveMessage(task.accountId, task.conversationId, result);
        pushed = true;
      } catch (pushErr) {
        // Push failed (likely contextToken expired) — result still saved in run record
        console.warn(
          `[scheduler] push failed for task #${task.seq} (${task.accountId}): ${(pushErr as Error).message}`,
        );
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    error = msg;
    status = msg === "Execution timeout" ? "timeout" : "error";
    console.error(`[scheduler] task #${task.seq} (${task.accountId}) failed: ${msg}`);
  }

  const durationMs = Date.now() - startedAt;

  // Record the run
  await createRun(task.id, {
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

  await setTaskStatus(task.id, shouldPause ? "paused" : "idle", {
    lastRunAt: new Date(),
    lastError: isFailure ? error : null,
    failStreak: newFailStreak,
    runCount: { increment: 1 },
  });

  if (shouldPause) {
    console.warn(
      `[scheduler] task #${task.seq} (${task.accountId}) auto-paused after ${MAX_FAIL_STREAK} consecutive failures`,
    );
  }
}
