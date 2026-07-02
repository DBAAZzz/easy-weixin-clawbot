import assert from "node:assert/strict";
import test from "node:test";
import { heartbeatToolRegistry } from "./tool.js";

const abortSignal = new AbortController().signal;

test("create_pending_goal rejects scheduler run context", async () => {
  const result = await heartbeatToolRegistry.execute(
    "create_pending_goal",
    {
      description: "follow up later",
      context: "scheduled task could not finish",
      delay_minutes: 5,
    },
    {
      signal: abortSignal,
      accountId: "account-a",
      conversationId: "scheduler:1",
      targetConversationId: "wechat-room-1",
      runKind: "scheduler",
    },
  );

  assert.equal(result[0]?.type, "text");
  assert.match(result[0]?.text ?? "", /后台执行中不能创建新的 pending goal/);
});
