import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentRunEvent,
  AgentRunStore,
  AppendAgentRunEventInput,
  AppendResult,
  ArtifactContentSink,
  ArtifactRevisionStore,
  ArtifactKind,
} from "../../src/index.js";
import { AGENT_RUN_EVENT_TYPE } from "../../src/shared/fact-ledger/contracts.js";
import { createRunLedgerRecorder } from "../../src/engine/run-ledger/recorder.js";
import { INLINE_ARTIFACT_LIMIT_BYTES } from "../../src/engine/run-ledger/revisions.js";

function fakeStore(overrides: {
  append?: (input: AppendAgentRunEventInput) => Promise<AppendResult<AgentRunEvent>>;
} = {}): AgentRunStore & { appended: AppendAgentRunEventInput[] } {
  const appended: AppendAgentRunEventInput[] = [];
  return {
    appended,
    async append(input) {
      if (overrides.append) return overrides.append(input);
      appended.push(input);
      return {
        value: {
          ...input,
          runSeq: appended.length,
          recordedAt: "2026-08-29T00:00:00.000Z",
        } as AgentRunEvent,
        appended: true,
      };
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
  } as AgentRunStore & { appended: AppendAgentRunEventInput[] };
}

function fakeArtifactStore(): ArtifactRevisionStore {
  const store = {
    putCalls: [] as string[],
    async put(input: { artifactId: string }) {
      store.putCalls.push(input.artifactId);
      return {
        value: {
          artifactId: input.artifactId,
          kind: "canonical_request" as ArtifactKind,
          sha256: "a".repeat(64),
          schemaVersion: 1,
          contentLocation: "inline" as const,
          createdAt: "2026-08-29T00:00:00.000Z",
        },
        appended: true,
      };
    },
    async getById() {
      return null;
    },
    async getByContent() {
      return null;
    },
  };
  return store as unknown as ArtifactRevisionStore;
}

function makeRecorder(overrides: { append?: (input: AppendAgentRunEventInput) => Promise<AppendResult<AgentRunEvent>> } = {}) {
  const store = fakeStore(overrides);
  const totals: string[] = [];
  const events: string[] = [];
  const recorder = createRunLedgerRecorder({
    agentRunStore: store,
    artifactRevisionStore: fakeArtifactStore(),
    accountId: "account-1",
    runId: "run-1",
    metrics: {
      total(result) {
        totals.push(result);
      },
      event(eventType) {
        events.push(eventType);
      },
      inlineLatencyMs() {},
      artifactPut() {},
      manifest() {},
    },
  });
  return { recorder, store, totals, events };
}

const start = { conversationStreamId: "stream-1", sourceEventId: "trigger-1", occurredAt: "2026-08-29T00:00:00.000Z" };

test("inline writes are ordered and awaited before the turn proceeds", async () => {
  const { recorder, store } = makeRecorder();
  assert.equal(await recorder.start(start), true);
  assert.equal(await recorder.recordContextCompiled("manifest-1"), true);
  assert.deepEqual(
    store.appended.map((event) => event.eventType),
    ["run_started", "context_compiled"],
  );
  const started = store.appended[0]!;
  assert.deepEqual(started.payload, { runKind: "chat", triggerEventId: "trigger-1" });
  assert.equal(started.correlationId, "trigger-1");
  await recorder.drain();
});

test("queued writes keep logical FIFO order across concurrent callers", async () => {
  const { recorder, store } = makeRecorder();
  await recorder.start(start);
  recorder.recordModelCallStarted({ round: 1, manifestId: "m", requestDoc: { round: 1 } });
  recorder.recordModelCallCompleted({ round: 1, stopReason: "stop", responseDoc: { text: "hi" } });
  recorder.recordModelCallStarted({ round: 2, manifestId: "m", requestDoc: { round: 2 } });
  await recorder.drain();
  assert.deepEqual(
    store.appended.map((event) => event.eventType),
    ["run_started", "model_call_started", "model_call_completed", "model_call_started"],
  );
  assert.equal(recorder.getFinalResponseArtifactId()?.startsWith("model-response-v1:"), true);
});

test("failure degrades the run, appends a ledger_degraded marker and drops pending work", async () => {
  let calls = 0;
  const { recorder, store, totals } = makeRecorder({
    async append(input) {
      calls += 1;
      if (calls === 2) throw new Error("db down");
      store.appended.push(input);
      return {
        value: { ...input, runSeq: calls, recordedAt: "2026-08-29T00:00:00.000Z" } as AgentRunEvent,
        appended: true,
      };
    },
  });
  assert.equal(await recorder.start(start), true);
  recorder.recordModelCallStarted({ round: 1, manifestId: "m", requestDoc: { round: 1 } });
  recorder.recordModelCallStarted({ round: 2, manifestId: "m", requestDoc: { round: 2 } });
  await recorder.drain();
  assert.equal(recorder.isDegraded(), true);
  assert.deepEqual(totals, ["degraded"]);
  // start + the best-effort terminal marker; the failing put and everything
  // after it are dropped.
  assert.deepEqual(
    store.appended.map((event) => event.eventType),
    ["run_started", "run_interrupted"],
  );
  assert.deepEqual(store.appended[1]?.payload, { reason: "ledger_degraded" });
});

test("delivery_requested records the last response artifact", async () => {
  const { recorder, store } = makeRecorder();
  await recorder.start(start);
  recorder.recordModelCallCompleted({ round: 1, stopReason: "stop", responseDoc: { reply: 1 } });
  await recorder.drain();
  await recorder.finishCompleted({ rounds: 1, finalResponseArtifactId: recorder.getFinalResponseArtifactId() });
  await recorder.recordDeliveryRequested({ deliveryId: "delivery-1" });
  await recorder.drain();
  const delivered = store.appended.at(-1)!;
  assert.equal(delivered.eventType, "delivery_requested");
  assert.match(
    (delivered.payload as { responseArtifactId: string }).responseArtifactId,
    /^model-response-v1:/,
  );
});

test("oversized documents go through the content sink as storage references", async () => {
  const sinkCalls: string[] = [];
  const sink: ArtifactContentSink = {
    async put(key) {
      sinkCalls.push(key);
      return { provider: "local-fact-ledger", key };
    },
    async get() {
      return null;
    },
  };
  const store = fakeStore();
  const artifactStore = fakeArtifactStore();
  const recorder = createRunLedgerRecorder({
    agentRunStore: store,
    artifactRevisionStore: artifactStore,
    contentSink: sink,
    accountId: "account-1",
    runId: "run-1",
  });
  await recorder.start(start);
  const bigDoc = { blob: "x".repeat(INLINE_ARTIFACT_LIMIT_BYTES + 10) };
  recorder.recordModelCallCompleted({ round: 1, stopReason: "stop", responseDoc: bigDoc });
  await recorder.drain();
  assert.equal(sinkCalls.length, 1);
  assert.match(sinkCalls[0]!, /^model-response\//);
  const event = store.appended.at(-1)!;
  assert.equal(event.eventType, AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED);
  const payload = event.payload as { responseArtifactId: string };
  assert.match(payload.responseArtifactId, /^model-response-v1:[a-f0-9]{64}$/);
});
