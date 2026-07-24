import assert from "node:assert/strict";
import test from "node:test";
import { createChatEngine, type ChatLog } from "../../src/engine/chat-engine.js";
import type { RunContext } from "../../src/engine/context.js";
import type { AgentRunner } from "../../src/engine/runner.js";
import type { AssistantMessage } from "../../src/llm/types.js";
import {
  setMessageStore,
  setModelConfigStore,
  setTapeStore,
  setUsageStore,
  type MessageStore,
  type ModelConfigRow,
  type ModelConfigStore,
  type ModelScope,
  type PersistMessageParams,
  type TapeStore,
} from "../../src/ports/index.js";

function createEmptyTapeStore(): TapeStore {
  return {
    async createEntry() {
      return "entry-1";
    },
    async findEntries() {
      return [];
    },
    async findAllEntries() {
      return [];
    },
    async listBranches() {
      return [];
    },
    async findLatestAnchor() {
      return null;
    },
    async createAnchor() {
      return "anchor-1";
    },
    async markCompacted() {},
    async compactTransaction() {},
    async purgeCompacted() {
      return 0;
    },
  };
}

function createFakeMessageStore(): MessageStore & {
  persisted: PersistMessageParams[];
  rolledBack: Array<{ accountId: string; conversationId: string; count: number }>;
} {
  const persisted: PersistMessageParams[] = [];
  const rolledBack: Array<{ accountId: string; conversationId: string; count: number }> = [];

  return {
    persisted,
    rolledBack,
    async restoreHistory() {
      return { messages: [], maxSeq: 0 };
    },
    queuePersistMessage(params) {
      persisted.push(params);
    },
    async rollbackMessages(accountId, conversationId, count) {
      rolledBack.push({ accountId, conversationId, count });
    },
    async clearMessages() {},
    async getMessagesSince() {
      return [];
    },
  };
}

function createFakeModelConfigStore(): ModelConfigStore {
  const row: ModelConfigRow = {
    id: 1n,
    scope: "global",
    scopeKey: "*",
    purpose: "chat",
    templateId: 1n,
    templateName: "default-template",
    provider: "openai",
    modelId: "gpt-5",
    modelIds: ["gpt-5"],
    apiKey: "test-key",
    baseUrl: null,
    supportsImageInputOverride: "default",
    templateEnabled: true,
    enabled: true,
    priority: 0,
  };

  async function unsupported(): Promise<never> {
    throw new Error("not implemented in test");
  }

  return {
    async findByScope(scope: ModelScope, scopeKey: string) {
      return scope === "global" && scopeKey === "*" ? [row] : [];
    },
    listTemplates: unsupported,
    createTemplate: unsupported,
    updateTemplate: unsupported,
    deleteTemplate: unsupported,
    getTemplateById: unsupported,
    countConfigsForTemplate: unsupported,
    listAllConfigs: unsupported,
    upsertConfig: unsupported,
    deleteConfig: unsupported,
  };
}

const noopLog: ChatLog = {
  llm() {},
  tool() {},
  done() {},
};

function baseCtx(overrides: Partial<RunContext> = {}): RunContext {
  return { accountId: "acc", conversationId: "conv", runKind: "chat", ...overrides };
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    timestamp: Date.now(),
    stopReason: "stop",
    ...overrides,
  };
}

test.beforeEach(() => {
  setModelConfigStore(createFakeModelConfigStore());
  setUsageStore({ queueRecord() {} });
  setTapeStore(createEmptyTapeStore());
});

test("chat() happy path persists the turn and returns the reply text", async () => {
  const messageStore = createFakeMessageStore();
  setMessageStore(messageStore);

  const runner: AgentRunner = {
    async run(_messages, callbacks) {
      callbacks.onRoundStart?.(1);
      const reply = assistantMessage({
        content: [{ type: "text", text: "你好！" }],
        stopReason: "stop",
      });
      callbacks.onMessage(reply);
      return { status: "completed", finalMessage: reply };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const reply = await engine.chat(baseCtx(), { text: "hi" });

  assert.equal(reply.text, "你好！");
  assert.equal(messageStore.rolledBack.length, 0);
  assert.equal(messageStore.persisted.length, 2);
  assert.equal(messageStore.persisted[0]?.message.role, "user");
  assert.equal(messageStore.persisted[1]?.message.role, "assistant");
});

test("chat() rolls back the turn when the model returns an empty error response", async () => {
  const messageStore = createFakeMessageStore();
  setMessageStore(messageStore);

  const runner: AgentRunner = {
    async run(_messages, callbacks) {
      callbacks.onRoundStart?.(1);
      // Empty content + non-STOP stopReason simulates a provider error response.
      const errored = assistantMessage({ content: [], stopReason: "error" });
      callbacks.onMessage(errored);
      return { status: "completed", finalMessage: errored };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const reply = await engine.chat(baseCtx(), { text: "hi" });

  assert.equal(reply.text, "抱歉，出了点问题，请稍后再试。");
  // Empty assistant messages are never persisted — only the user turn was queued.
  assert.equal(messageStore.persisted.length, 1);
  assert.equal(messageStore.persisted[0]?.message.role, "user");
  // Exactly the 1 message the runner added during this run gets rolled back.
  assert.deepEqual(messageStore.rolledBack, [{ accountId: "acc", conversationId: "conv", count: 1 }]);
});

test("chat() falls back to the max-rounds message when the loop is cut off without a reply", async () => {
  const messageStore = createFakeMessageStore();
  setMessageStore(messageStore);

  const runner: AgentRunner = {
    async run(_messages, callbacks) {
      callbacks.onRoundStart?.(10);
      const last = assistantMessage({ content: [], stopReason: "toolUse" });
      callbacks.onMessage(last);
      return { status: "max_rounds", lastMessage: last, rounds: 10 };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const reply = await engine.chat(baseCtx(), { text: "hi" });

  assert.equal(reply.text, "抱歉，这次问题我还没处理完。");
  // max_rounds never rolls back — the partial turn stays in history.
  assert.equal(messageStore.rolledBack.length, 0);
});

test("chat() surfaces the model's own text when max_rounds is hit with a real reply", async () => {
  const messageStore = createFakeMessageStore();
  setMessageStore(messageStore);

  const runner: AgentRunner = {
    async run(_messages, callbacks) {
      const last = assistantMessage({ content: [{ type: "text", text: "线索还在处理中" }] });
      callbacks.onMessage(last);
      return { status: "max_rounds", lastMessage: last, rounds: 10 };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const reply = await engine.chat(baseCtx(), { text: "hi" });

  assert.equal(reply.text, "线索还在处理中");
});
