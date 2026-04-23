import assert from "node:assert/strict";
import test from "node:test";
import {
  appendAssistantTextMessage,
  getHistory,
  setMessageStore,
  type MessageStore,
  type PersistMessageParams,
} from "@clawbot/agent";

function createMessageStore(queue: PersistMessageParams[]): MessageStore {
  return {
    async restoreHistory() {
      return { messages: [], maxSeq: 0 };
    },
    queuePersistMessage(params) {
      queue.push(params);
    },
    async rollbackMessages() {},
    async clearMessages() {},
    async getMessagesSince() {
      return [];
    },
  };
}

test("appendAssistantTextMessage appends assistant message into history and persistence queue", async () => {
  const queued: PersistMessageParams[] = [];
  setMessageStore(createMessageStore(queued));

  const accountId = "proactive-account";
  const conversationId = "wechat-conv#effective";

  await appendAssistantTextMessage(accountId, conversationId, "第一条主动消息");
  await appendAssistantTextMessage(accountId, conversationId, "第二条主动消息");

  assert.equal(queued.length, 2);
  assert.equal(queued[0]?.conversationId, conversationId);
  assert.equal(queued[0]?.seq, 1);
  assert.equal(queued[0]?.message.role, "assistant");
  assert.deepEqual(queued[0]?.message.content, [{ type: "text", text: "第一条主动消息" }]);
  assert.equal(queued[1]?.seq, 2);

  const history = getHistory(accountId, conversationId);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.role, "assistant");
  assert.deepEqual(history[1]?.content, [{ type: "text", text: "第二条主动消息" }]);
});
