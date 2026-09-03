import assert from "node:assert/strict";
import test from "node:test";
import type {
  ChatEngine,
  ChatTurnInput,
  CompiledContextV1,
  ContextCompilerV1,
  ConversationEventStore,
  ArtifactContentSink,
  ArtifactRevisionStore,
  AgentRunStore,
} from "@clawbot/agent";
import {
  CONTEXT_POLICY_REVISION_ID_V4,
  createTriggerRunId,
  setAgentRunStore,
  setArtifactRevisionStore,
  setConversationEventStore,
} from "@clawbot/agent";
import { createChatExecutor } from "../../src/db/chat-executor.impl.js";
import type { RunLedgerRolloutStore } from "../../src/db/run-ledger-rollout-store.js";

function fakeRollout(
  enabled: boolean,
  readPath: "legacy" | "dual" | "canonical" = "legacy",
  memoryReadPath: "tape" | "dual" | "events" = "tape",
) {
  return {
    isEnabled: async () => enabled,
    readPath: async () => readPath,
    legacyWriteMode: async () => "prompt_shaped" as const,
    memoryReadPath: async () => memoryReadPath,
  } as unknown as RunLedgerRolloutStore;
}

function fakePorts(headSeq: number | undefined) {
  const appended: unknown[] = [];
  const agentRunStore = {
    appended,
    async append(input: unknown) {
      appended.push(input);
      return { value: input, appended: true };
    },
    async getById() {
      return null;
    },
    async listRun() {
      return [];
    },
    async listRunEventsByStream() {
      return [];
    },
  } as unknown as AgentRunStore;
  const artifactRevisionStore = {
    async put() {
      throw new Error("not used");
    },
    async getById() {
      return null;
    },
    async getByContent() {
      return null;
    },
  } as unknown as ArtifactRevisionStore;
  const conversationEventStore = {
    async append() {
      throw new Error("not used");
    },
    async getById() {
      return null;
    },
    async listStream() {
      return [];
    },
    async getStreamHeadSeq() {
      return headSeq;
    },
  } as unknown as ConversationEventStore;
  setAgentRunStore(agentRunStore);
  setArtifactRevisionStore(artifactRevisionStore);
  setConversationEventStore(conversationEventStore);
}

interface CapturedCall {
  input: ChatTurnInput;
}

function fakeChatEngine(capture: CapturedCall): ChatEngine {
  return {
    conversations: {
      withLock: (_accountId: string, _conversationId: string, fn: () => Promise<unknown>) => fn(),
    },
    async chat(_ctx: unknown, input: ChatTurnInput) {
      capture.input = input;
      return { text: "reply" };
    },
  } as unknown as ChatEngine;
}

function fakeCompiler(): ContextCompilerV1 & { calls: unknown[] } {
  const compiled = {
    context: { entries: [] },
    diagnostics: [],
    canonicalContextHash: "hash",
    conversationEventIds: [],
  } as unknown as CompiledContextV1;
  const calls: unknown[] = [];
  return {
    calls,
    compile: async (input: unknown) => {
      calls.push(input);
      return compiled;
    },
  } as unknown as ContextCompilerV1 & { calls: unknown[] };
}

const contentSink = {
  async put() {
    throw new Error("not used");
  },
  async get() {
    return null;
  },
} as ArtifactContentSink;

const triggerIdentity = {
  source: "heartbeat" as const,
  entityId: "42",
  fireAtISO: "2026-08-30T10:00:00.000Z",
};

test("rollout off → Phase 5 shape: no runLedger, no runId, legacy read path", async () => {
  fakePorts(undefined);
  const capture: CapturedCall = { input: {} as ChatTurnInput };
  const executor = createChatExecutor(fakeChatEngine(capture), {
    compiler: fakeCompiler(),
    contentSink,
    rolloutStore: fakeRollout(false, "canonical"),
  });
  const result = await executor.execute({
    accountId: "account-1",
    conversationId: "conv-1",
    prompt: "pulse",
    runKind: "heartbeat",
    inputRole: "trigger",
    triggerIdentity,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.runId, undefined);
  assert.equal(capture.input.runLedger, undefined);
  assert.equal(capture.input.contextReadPath, undefined);
});

test("rollout on → deterministic trigger runId, anchor seq, policy v4 compile closure", async () => {
  fakePorts(5);
  const capture: CapturedCall = { input: {} as ChatTurnInput };
  const compiler = fakeCompiler();
  const executor = createChatExecutor(fakeChatEngine(capture), {
    compiler,
    contentSink,
    rolloutStore: fakeRollout(true, "legacy"),
  });
  const result = await executor.execute({
    accountId: "account-1",
    conversationId: "conv-1",
    prompt: "pulse",
    runKind: "heartbeat",
    inputRole: "trigger",
    triggerIdentity,
  });

  const expectedRunId = createTriggerRunId("account-1", "heartbeat", "42", triggerIdentity.fireAtISO);
  assert.equal(result.runId, expectedRunId);

  const runLedger = capture.input.runLedger;
  assert.ok(runLedger, "runLedger wiring is passed to the turn");
  assert.equal(runLedger.recorder.runId, expectedRunId);
  assert.equal(runLedger.conversationStreamId, "conv-1");
  assert.equal(runLedger.sourceEventId, undefined, "trigger runs carry no ingress source");
  assert.equal(runLedger.anchorStreamSeq, 5);
  assert.equal(runLedger.contentSink, contentSink);

  // compileContext 走 v4（Phase 7：= v3 + legacy entries），eventCursor = anchor。
  await runLedger.compileContext({});
  assert.equal(compiler.calls.length, 1);
  const compileInput = compiler.calls[0] as Record<string, unknown>;
  assert.equal(compileInput.contextPolicyRevisionId, CONTEXT_POLICY_REVISION_ID_V4);
  assert.equal(compileInput.eventCursor, 5);
  assert.equal(compileInput.conversationStreamId, "conv-1");
});

test("read_path from the rollout maps onto ChatTurnInput.contextReadPath", async () => {
  fakePorts(undefined);
  const capture: CapturedCall = { input: {} as ChatTurnInput };
  const executor = createChatExecutor(fakeChatEngine(capture), {
    compiler: fakeCompiler(),
    contentSink,
    rolloutStore: fakeRollout(true, "dual"),
  });
  await executor.execute({
    accountId: "account-1",
    conversationId: "conv-1",
    prompt: "pulse",
    runKind: "heartbeat",
    inputRole: "trigger",
    triggerIdentity,
  });
  assert.equal(capture.input.contextReadPath, "dual");
});

test("empty execution stream → compile cursor 0, no anchor payload", async () => {
  fakePorts(undefined);
  const capture: CapturedCall = { input: {} as ChatTurnInput };
  const compiler = fakeCompiler();
  const executor = createChatExecutor(fakeChatEngine(capture), {
    compiler,
    contentSink,
    rolloutStore: fakeRollout(true, "legacy"),
  });
  const result = await executor.execute({
    accountId: "account-1",
    conversationId: "scheduler:1",
    prompt: "task",
    runKind: "scheduler",
    triggerIdentity: {
      source: "scheduler",
      entityId: "7",
      fireAtISO: "2026-08-30T11:00:00.000Z",
    },
  });
  assert.ok(result.runId);
  assert.equal(capture.input.runLedger?.anchorStreamSeq, undefined);
  await capture.input.runLedger!.compileContext({});
  const compileInput = compiler.calls[0] as Record<string, unknown>;
  assert.equal(compileInput.eventCursor, 0, "fresh scheduler stream compiles an empty window");
});
