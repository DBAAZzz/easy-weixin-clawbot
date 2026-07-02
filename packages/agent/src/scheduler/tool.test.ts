import assert from "node:assert/strict";
import test from "node:test";
import type {
  CreateTaskInput,
  ScheduledTaskRow,
  SchedulerStore,
} from "../ports/scheduler-store.js";
import { setSchedulerStore } from "../ports/scheduler-store.js";
import { schedulerToolRegistry } from "./tool.js";
import { deactivate } from "./manager.js";

const abortSignal = new AbortController().signal;

function makeTask(input: CreateTaskInput): ScheduledTaskRow {
  return {
    id: 1n,
    accountId: input.accountId,
    conversationId: input.conversationId,
    seq: 1,
    name: input.name,
    prompt: input.prompt,
    taskKind: input.taskKind ?? "prompt",
    configJson: input.configJson ?? {},
    type: input.type ?? "recurring",
    cron: input.cron,
    timezone: input.timezone ?? "Asia/Shanghai",
    enabled: true,
    status: "idle",
    runCount: 0,
    failStreak: 0,
    lastRunAt: null,
    nextRunAt: null,
    lastError: null,
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    updatedAt: new Date("2026-07-02T00:00:00.000Z"),
  };
}

function createStore(onCreate: (input: CreateTaskInput) => void): SchedulerStore {
  return {
    async createTask(input) {
      onCreate(input);
      return makeTask(input);
    },
    async updateTask() {
      return null;
    },
    async deleteTask() {
      return false;
    },
    async getTaskBySeq() {
      return null;
    },
    async getTaskById() {
      return null;
    },
    async listTasks() {
      return [];
    },
    async listEnabledTasks() {
      return [];
    },
    async setTaskStatus() {},
    async createRun() {
      throw new Error("not implemented");
    },
    async listRuns() {
      return [];
    },
    async findUnpushedRuns() {
      return [];
    },
    async markRunPushed() {},
  };
}

test("create_scheduled_task uses run-scoped target conversation context", async () => {
  let created: CreateTaskInput | undefined;
  setSchedulerStore(createStore((input) => {
    created = input;
  }));

  const result = await schedulerToolRegistry.execute(
    "create_scheduled_task",
    {
      name: "daily summary",
      cron: "0 9 * * *",
      prompt: "summarize",
    },
    {
      signal: abortSignal,
      accountId: "account-a",
      conversationId: "session-1",
      targetConversationId: "wechat-room-1",
      runKind: "chat",
    },
  );

  deactivate(1n);

  assert.equal(created?.accountId, "account-a");
  assert.equal(created?.conversationId, "wechat-room-1");
  assert.equal(result[0]?.type, "text");
  assert.match(result[0]?.text ?? "", /定时任务已创建/);
});
