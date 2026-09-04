import assert from "node:assert/strict";
import test from "node:test";
import { createChatEngine, type ChatEngine, type ChatLog } from "../../src/engine/chat-engine.js";
import type { RunContext } from "../../src/engine/context.js";
import type { AgentRunner } from "../../src/engine/runner.js";
import type { AssistantMessage } from "../../src/llm/types.js";
import { createContextShadowObserver } from "../../src/engine/context-shadow/observer.js";
import type {
  CanonicalContextV1,
  ContextCompilerDiagnostic,
  ContextCompilerShadowDiffCounts,
  ContextCompilerV1,
} from "../../src/context-compiler/index.js";
import type { ContextCompilerShadowResultRecord } from "../../src/ports/context-compiler-shadow-result-store.js";
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
    async listAnchors() {
      return [];
    },
    async attachAnchorSummary() {},
  };
}

function createFakeMessageStore(): MessageStore & { rolledBack: number[] } {
  return {
    rolledBack: [],
    async restoreHistory() {
      return { messages: [], maxSeq: 0 };
    },
    queuePersistMessage(_params: PersistMessageParams) {},
    async rollbackMessages(_accountId, _conversationId, count) {
      this.rolledBack.push(count);
    },
    async clearMessages() {},
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

const noopLog: ChatLog = { llm() {}, tool() {}, done() {} };

const canonicalContext: CanonicalContextV1 = {
  schemaVersion: 1,
  compilerVersion: "context-compiler-v1",
  contextPolicyRevisionId: "context-policy-v2",
  accountId: "acc",
  conversationStreamId: "stream-1",
  eventCursor: 1,
  entries: [
    {
      eventId: "event-1",
      streamSeq: 1,
      role: "user",
      occurredAt: "2026-08-28T00:00:00.000Z",
      text: "hi",
      attachments: [],
    },
  ],
  runtimeContext: { effectiveTime: "2026-08-28T08:00:00.000+08:00", timezone: "Asia/Shanghai" },
  coverage: {
    conversationFacts: true,
    assistantRunFacts: false,
    toolRunFacts: false,
    memoryFacts: false,
    immutableMediaArtifacts: false,
  },
};

interface ShadowHarness {
  records: ContextCompilerShadowResultRecord[];
  totals: string[];
  failCompileWith?: Error & { code: string };
}

function createShadow(harness: ShadowHarness) {
  const compiler: ContextCompilerV1 = {
    async compile() {
      if (harness.failCompileWith) throw harness.failCompileWith;
      return {
        context: canonicalContext,
        diagnostics: [] as ContextCompilerDiagnostic[],
        canonicalContextHash: "a".repeat(64),
        conversationEventIds: [],
      };
    },
  };
  return createContextShadowObserver({
    compiler,
    resultStore: {
      async createOrVerifyEquivalent(record) {
        harness.records.push(record);
      },
    },
    metrics: {
      total(result) {
        harness.totals.push(result);
      },
      diff(_counts: ContextCompilerShadowDiffCounts) {},
      entries() {},
      unresolvedAttachments() {},
      durationMs() {},
    },
    onError() {},
  });
}

function assistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant" as const,
    content: [],
    timestamp: Date.now(),
    stopReason: "stop",
    ...overrides,
  };
}

const baseCtx: RunContext = { accountId: "acc", conversationId: "conv", runKind: "chat" };

function chatLocked(engine: ChatEngine, shadow: ReturnType<typeof createShadow>) {
  return engine.conversations.withLock(baseCtx.accountId, baseCtx.conversationId, () =>
    engine.chat(baseCtx, {
      text: "hi",
      contextShadow: {
        observer: shadow,
        sourceEventId: "event-1",
        conversationStreamId: "stream-1",
        eventCursor: 1,
      },
    }),
  );
}

test.beforeEach(() => {
  setModelConfigStore(createFakeModelConfigStore());
  setUsageStore({ queueRecord() {} });
  setTapeStore(createEmptyTapeStore());
});

test("a committed turn publishes exactly one success record", async () => {
  const harness: ShadowHarness = { records: [], totals: [] };
  setMessageStore(createFakeMessageStore());

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
  const shadow = createShadow(harness);
  const reply = await chatLocked(engine, shadow);
  await shadow.drain();

  assert.equal(reply.text, "你好！");
  assert.equal(harness.records.length, 1);
  const record = harness.records[0]!;
  assert.equal(record.status, "success");
  assert.equal(record.accountId, "acc");
  assert.equal(record.eventCursor, 1);
  // The snapshot was cloned before the runner appended its assistant message.
  assert.equal(record.legacyEntryCount, 1);
  assert.deepEqual(harness.totals, ["success"]);
});

test("a thrown runner turn discards the pending shadow", async () => {
  const harness: ShadowHarness = { records: [], totals: [] };
  setMessageStore(createFakeMessageStore());

  const runner: AgentRunner = {
    async run() {
      throw new Error("model exploded");
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const shadow = createShadow(harness);
  await assert.rejects(() => chatLocked(engine, shadow), /model exploded/);
  await shadow.drain();

  assert.deepEqual(harness.records, []);
  assert.deepEqual(harness.totals, ["skipped_turn_failed"]);
});

test("an empty error response rolls back and discards the pending shadow", async () => {
  const harness: ShadowHarness = { records: [], totals: [] };
  const messageStore = createFakeMessageStore();
  setMessageStore(messageStore);

  const runner: AgentRunner = {
    async run(_messages, callbacks) {
      callbacks.onRoundStart?.(1);
      const errored = assistantMessage({ content: [], stopReason: "error" });
      callbacks.onMessage(errored);
      return { status: "completed", finalMessage: errored };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const shadow = createShadow(harness);
  const reply = await chatLocked(engine, shadow);
  await shadow.drain();

  assert.match(reply.text ?? "", /抱歉/);
  assert.deepEqual(harness.records, []);
  assert.deepEqual(harness.totals, ["skipped_turn_failed"]);
  assert.ok(messageStore.rolledBack.length >= 1);
});

test("max_rounds turns with a real reply still publish", async () => {
  const harness: ShadowHarness = { records: [], totals: [] };
  setMessageStore(createFakeMessageStore());

  const runner: AgentRunner = {
    async run(_messages, callbacks) {
      const last = assistantMessage({ content: [{ type: "text", text: "线索还在处理中" }] });
      callbacks.onMessage(last);
      return { status: "max_rounds", lastMessage: last, rounds: 10 };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const shadow = createShadow(harness);
  const reply = await chatLocked(engine, shadow);
  await shadow.drain();

  assert.equal(reply.text, "线索还在处理中");
  assert.equal(harness.records.length, 1);
  assert.deepEqual(harness.totals, ["success"]);
});

test("aborted turns discard the pending shadow", async () => {
  const harness: ShadowHarness = { records: [], totals: [] };
  setMessageStore(createFakeMessageStore());

  const runner: AgentRunner = {
    async run() {
      return { status: "aborted" };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const shadow = createShadow(harness);
  await chatLocked(engine, shadow);
  await shadow.drain();

  assert.deepEqual(harness.records, []);
  assert.deepEqual(harness.totals, ["skipped_turn_failed"]);
});

test("a shadow compile failure never breaks the production turn", async () => {
  const harness: ShadowHarness = { records: [], totals: [] };
  harness.failCompileWith = Object.assign(new Error("unsupported event"), {
    code: "unsupported_schema_version",
  });
  setMessageStore(createFakeMessageStore());

  const runner: AgentRunner = {
    async run(_messages, callbacks) {
      const reply = assistantMessage({
        content: [{ type: "text", text: "你好！" }],
        stopReason: "stop",
      });
      callbacks.onMessage(reply);
      return { status: "completed", finalMessage: reply };
    },
  };

  const engine = createChatEngine({ runner, log: noopLog });
  const shadow = createShadow(harness);
  const reply = await chatLocked(engine, shadow);
  await shadow.drain();

  assert.equal(reply.text, "你好！");
  assert.equal(harness.records[0]?.status, "failed");
  assert.equal(harness.records[0]?.errorCode, "unsupported_schema_version");
});
