import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { executeTask } from "../../../src/capabilities/scheduler/executor.js";
import { schedulerConversationId } from "../../../src/capabilities/scheduler/constants.js";
import {
  setChatExecutor,
  setPushService,
  setSchedulerStore,
  type ChatExecutionRequest,
  type ChatExecutorPort,
  type CreateRunInput,
  type ScheduledTaskRow,
  type SchedulerStore,
} from "../../../src/ports/index.js";

function createTask(overrides: Partial<ScheduledTaskRow> = {}): ScheduledTaskRow {
  return {
    id: 1n,
    accountId: "acc",
    conversationId: "wechat-conv-99",
    seq: 42,
    name: "task",
    prompt: "do the thing",
    taskKind: "prompt",
    configJson: {},
    type: "recurring",
    cron: "*/5 * * * *",
    timezone: "Asia/Shanghai",
    enabled: true,
    status: "idle",
    runCount: 0,
    failStreak: 0,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createFakeSchedulerStore(): SchedulerStore & {
  runs: CreateRunInput[];
  statuses: string[];
} {
  const runs: CreateRunInput[] = [];
  const statuses: string[] = [];

  async function unsupported(): Promise<never> {
    throw new Error("not implemented in test");
  }

  return {
    runs,
    statuses,
    createTask: unsupported,
    updateTask: unsupported,
    deleteTask: unsupported,
    getTaskBySeq: unsupported,
    getTaskById: unsupported,
    listTasks: unsupported,
    listEnabledTasks: unsupported,
    async setTaskStatus(_id, status) {
      statuses.push(status);
    },
    async createRun(taskId, data) {
      runs.push(data);
      return {
        id: BigInt(runs.length),
        taskId,
        status: data.status,
        prompt: data.prompt,
        result: data.result ?? null,
        durationMs: data.durationMs ?? null,
        error: data.error ?? null,
        pushed: data.pushed,
        createdAt: new Date(),
      };
    },
    listRuns: unsupported,
    findUnpushedRuns: unsupported,
    markRunPushed: unsupported,
  };
}

// Flush pending microtasks (the async port calls between executeTask() being
// invoked and it reaching the mocked setTimeout call) without relying on the
// mocked setTimeout itself.
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("executeTask runs in the isolated scheduler:{seq} conversation and targets the task's real conversation for push", async () => {
  const store = createFakeSchedulerStore();
  setSchedulerStore(store);

  const pushed: Array<{ accountId: string; conversationId: string; text: string }> = [];
  setPushService({
    async sendProactiveMessage(accountId, conversationId, text) {
      pushed.push({ accountId, conversationId, text });
    },
  });

  let capturedRequest: ChatExecutionRequest | undefined;
  const executor: ChatExecutorPort = {
    async execute(req) {
      capturedRequest = req;
      return { status: "completed", text: "done" };
    },
  };
  setChatExecutor(executor);

  const task = createTask();
  await executeTask(task);

  assert.equal(capturedRequest?.accountId, "acc");
  assert.equal(capturedRequest?.conversationId, schedulerConversationId(42));
  assert.equal(capturedRequest?.targetConversationId, "wechat-conv-99");
  assert.equal(capturedRequest?.runKind, "scheduler");
  assert.ok(capturedRequest?.signal instanceof AbortSignal);
  assert.equal(capturedRequest?.signal?.aborted, false);

  assert.deepEqual(pushed, [{ accountId: "acc", conversationId: "wechat-conv-99", text: "done" }]);
  assert.deepEqual(store.statuses, ["running", "idle"]);
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0]?.status, "success");
  assert.equal(store.runs[0]?.pushed, true);
});

test("executeTask aborts the executor's signal and records a timeout run past the execution deadline", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const store = createFakeSchedulerStore();
    setSchedulerStore(store);
    setPushService({ async sendProactiveMessage() {} });

    let aborted = false;
    const executor: ChatExecutorPort = {
      execute(req) {
        // Simulates a hung chat call: it never settles on its own, it only
        // observes the abort. executeTask must not wait for it past the deadline.
        return new Promise(() => {
          req.signal?.addEventListener("abort", () => {
            aborted = true;
          });
        });
      },
    };
    setChatExecutor(executor);

    const runPromise = executeTask(createTask());

    // Let executeTask progress past its async port calls up to the point
    // where runChatTaskWithTimeout registers its 60s setTimeout.
    await flushMicrotasks();
    mock.timers.tick(60_000);
    await runPromise;

    assert.equal(aborted, true);
    assert.equal(store.runs.length, 1);
    assert.equal(store.runs[0]?.status, "timeout");
    assert.deepEqual(store.statuses, ["running", "idle"]);
  } finally {
    mock.timers.reset();
  }
});
