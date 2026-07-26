import assert from "node:assert/strict";
import test from "node:test";
import { createConversationCache } from "../../../src/engine/conversation/cache.js";
import type {
  MessageStore,
  PersistMessageParams,
  RestoredHistory,
} from "../../../src/ports/message-store.js";
import type { AgentMessage } from "../../../src/llm/types.js";

function textMessage(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function createFakeMessageStore(seed: Record<string, RestoredHistory> = {}): MessageStore & {
  persisted: PersistMessageParams[];
  rolledBack: Array<{ accountId: string; conversationId: string; count: number }>;
  cleared: Array<{ accountId: string; conversationId: string }>;
} {
  const persisted: PersistMessageParams[] = [];
  const rolledBack: Array<{ accountId: string; conversationId: string; count: number }> = [];
  const cleared: Array<{ accountId: string; conversationId: string }> = [];

  return {
    persisted,
    rolledBack,
    cleared,
    async restoreHistory(accountId, conversationId) {
      return seed[`${accountId}::${conversationId}`] ?? { messages: [], maxSeq: 0 };
    },
    queuePersistMessage(params) {
      persisted.push(params);
    },
    async rollbackMessages(accountId, conversationId, count) {
      rolledBack.push({ accountId, conversationId, count });
    },
    async clearMessages(accountId, conversationId) {
      cleared.push({ accountId, conversationId });
    },
    async getMessagesSince() {
      return [];
    },
  };
}

// Swap the global MessageStore port for the duration of a test, restoring it after.
async function withMessageStore<T>(store: MessageStore, fn: () => Promise<T>): Promise<T> {
  const { setMessageStore } = await import("../../../src/ports/message-store.js");
  setMessageStore(store);
  return fn();
}

test("nextSeq is monotonically increasing per conversation and independent across conversations", async () => {
  await withMessageStore(createFakeMessageStore(), async () => {
    const cache = createConversationCache();

    assert.equal(cache.nextSeq("acc", "conv-a"), 1);
    assert.equal(cache.nextSeq("acc", "conv-a"), 2);
    assert.equal(cache.nextSeq("acc", "conv-a"), 3);
    assert.equal(cache.currentSeq("acc", "conv-a"), 3);

    // A different conversation starts its own counter from zero.
    assert.equal(cache.nextSeq("acc", "conv-b"), 1);
    assert.equal(cache.currentSeq("acc", "conv-a"), 3);
  });
});

test("withLock serializes concurrent callers for the same conversation", async () => {
  await withMessageStore(createFakeMessageStore(), async () => {
    const cache = createConversationCache();
    const order: string[] = [];

    async function slowStep(label: string, ms: number) {
      return cache.withLock("acc", "conv", async () => {
        order.push(`${label}:start`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push(`${label}:end`);
      });
    }

    // Second call is issued before the first has released the lock — it must
    // wait, never interleave.
    const first = slowStep("a", 20);
    const second = slowStep("b", 0);
    await Promise.all([first, second]);

    assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end"]);
  });
});

test("LRU eviction drops the oldest conversation once maxCachedConversations is exceeded", async () => {
  await withMessageStore(createFakeMessageStore(), async () => {
    const cache = createConversationCache({ maxCachedConversations: 2 });

    await cache.ensureLoaded("acc", "conv-1");
    await cache.ensureLoaded("acc", "conv-2");
    await cache.ensureLoaded("acc", "conv-3");

    // conv-1 was least-recently-used and should have been evicted.
    assert.throws(() => cache.get("acc", "conv-1"), /History not loaded/);
    assert.doesNotThrow(() => cache.get("acc", "conv-2"));
    assert.doesNotThrow(() => cache.get("acc", "conv-3"));
  });
});

test("rollback clamps to the available history length instead of going negative", async () => {
  const store = createFakeMessageStore({
    "acc::conv": { messages: [textMessage("a"), textMessage("b")], maxSeq: 2 },
  });

  await withMessageStore(store, async () => {
    const cache = createConversationCache();
    await cache.ensureLoaded("acc", "conv");

    await cache.rollback("acc", "conv", 100);

    assert.equal(cache.get("acc", "conv").length, 0);
    assert.equal(cache.currentSeq("acc", "conv"), 0);
    assert.deepEqual(store.rolledBack, [{ accountId: "acc", conversationId: "conv", count: 2 }]);
  });
});
