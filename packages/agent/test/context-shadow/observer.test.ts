import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import type {
  AgentMessage,
  CanonicalContextV1,
  ContextCompilerDiagnostic,
  ContextCompilerShadowDiffCounts,
  ContextCompilerV1,
  ContextShadowObserver,
} from "../../src/index.js";
import type { ContextCompilerShadowResultRecord } from "../../src/ports/context-compiler-shadow-result-store.js";
import { ContextCompilerShadowResultEquivalenceError } from "../../src/ports/context-compiler-shadow-result-store.js";
import { createContextShadowObserver } from "../../src/engine/context-shadow/observer.js";

const canonicalContext: CanonicalContextV1 = {
  schemaVersion: 1,
  compilerVersion: "context-compiler-v1",
  contextPolicyRevisionId: "context-policy-v2",
  accountId: "account-1",
  conversationStreamId: "stream-1",
  eventCursor: 1,
  entries: [
    {
      eventId: "event-1",
      streamSeq: 1,
      role: "user",
      occurredAt: "2026-08-28T00:00:00.000Z",
      text: "hello",
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

function userMessage(text: string): AgentMessage {
  return {
    role: MESSAGE_ROLE.USER,
    timestamp: 1,
    content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text }],
  };
}

type CodedError = Error & { code: string };

function codedError(code: string, message: string): CodedError {
  return Object.assign(new Error(message), { code });
}

interface Harness {
  observer: ContextShadowObserver;
  records: ContextCompilerShadowResultRecord[];
  totals: string[];
  entries: Array<[string, number]>;
  errors: Array<{ sourceEventId: string; errorCode: string }>;
  failCompileWith?: CodedError;
  failStoreWith?: CodedError;
}

function createHarness(): Harness {
  const harness: Harness = {
    observer: undefined as never,
    records: [],
    totals: [],
    entries: [],
    errors: [],
  };

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
  const resultStore = {
    async createOrVerifyEquivalent(record: ContextCompilerShadowResultRecord) {
      if (harness.failStoreWith) throw harness.failStoreWith;
      harness.records.push(record);
    },
  };

  harness.observer = createContextShadowObserver({
    compiler,
    resultStore,
    metrics: {
      total(result) {
        harness.totals.push(result);
      },
      diff(_counts: ContextCompilerShadowDiffCounts) {},
      entries(side, count) {
        harness.entries.push([side, count]);
      },
      unresolvedAttachments(_count: number) {},
      durationMs(_duration: number) {},
    },
    onError(fields) {
      harness.errors.push(fields);
    },
  });
  return harness;
}

function startShadow(harness: Harness, messages: AgentMessage[]) {
  return harness.observer.start({
    sourceEventId: "event-1",
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventCursor: 1,
    effectiveTime: "2026-08-28T08:00:00.000+08:00",
    timezone: "Asia/Shanghai",
    compilerVersion: "context-compiler-v1",
    contextPolicyRevisionId: "context-policy-v2",
    legacyMessages: messages,
  });
}

test("publish writes a hash-only success record exactly once", async () => {
  const harness = createHarness();
  const handle = startShadow(harness, [userMessage("[当前时间: now]\nhello")]);
  await handle.publish();
  await handle.publish();

  assert.equal(harness.records.length, 1);
  const record = harness.records[0]!;
  assert.equal(record.status, "success");
  assert.equal(record.sourceEventId, "event-1");
  assert.equal(record.canonicalContextHash, "a".repeat(64));
  assert.match(record.canonicalMemoryInputHash ?? "", /^[a-f0-9]{64}$/);
  assert.match(record.legacySummaryHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(record.canonicalEntryCount, 1);
  assert.equal(record.legacyEntryCount, 1);
  assert.equal(record.diffCounts.match_user_text, 1);
  assert.deepEqual(harness.totals, ["success"]);
  assert.deepEqual(harness.entries, [
    ["canonical", 1],
    ["legacy", 1],
  ]);
  await harness.observer.drain();
});

test("discard prevents the result from ever reaching the store", async () => {
  const harness = createHarness();
  const handle = startShadow(harness, [userMessage("hello")]);
  handle.discard("turn_failed");
  await handle.publish();
  handle.discard("turn_failed");

  assert.deepEqual(harness.records, []);
  assert.deepEqual(harness.totals, ["skipped_turn_failed"]);
  await harness.observer.drain();
});

test("the legacy snapshot is cloned so later runner mutations do not leak in", async () => {
  const harness = createHarness();
  const messages: AgentMessage[] = [userMessage("hello")];
  const handle = startShadow(harness, messages);
  messages.push({
    role: MESSAGE_ROLE.ASSISTANT,
    timestamp: 2,
    content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "mutated-in" }],
  });
  await handle.publish();

  assert.equal(harness.records[0]?.legacyEntryCount, 1);
  assert.doesNotMatch(JSON.stringify(harness.records), /mutated-in/);
});

test("compile failure writes a classified failed record without bodies", async () => {
  const harness = createHarness();
  harness.failCompileWith = codedError("unsupported_schema_version", "unsupported event");
  const handle = startShadow(harness, [userMessage("secret body")]);
  await handle.publish();

  const record = harness.records[0]!;
  assert.equal(record.status, "failed");
  assert.equal(record.errorCode, "unsupported_schema_version");
  assert.equal(record.diffCounts.shadow_compile_failed, 1);
  assert.equal(record.canonicalContextHash, undefined);
  assert.doesNotMatch(JSON.stringify(record), /secret body/);
  assert.deepEqual(harness.totals, ["failed"]);
});

test("result sink failure is contained and reported through onError", async () => {
  const harness = createHarness();
  harness.failStoreWith = codedError("result_sink_failed", "sink down");
  const handle = startShadow(harness, [userMessage("hello")]);
  await handle.publish();

  assert.deepEqual(harness.records, []);
  assert.deepEqual(harness.totals, ["failed"]);
  assert.deepEqual(
    harness.errors.map((error) => error.errorCode),
    ["result_sink_failed"],
  );
  await harness.observer.drain();
});

test("equivalence conflicts surface their stable code through onError", async () => {
  const harness = createHarness();
  harness.failStoreWith = new ContextCompilerShadowResultEquivalenceError("event-1");
  const handle = startShadow(harness, [userMessage("hello")]);
  await handle.publish();

  assert.deepEqual(harness.records, []);
  assert.deepEqual(harness.totals, ["failed"]);
  assert.deepEqual(
    harness.errors.map((error) => error.errorCode),
    ["context_compiler_shadow_result_equivalence_conflict"],
  );
  await harness.observer.drain();
});

test("a synchronous start failure fails open with an inert handle", async () => {
  const harness = createHarness();
  const uncloneable = [
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "hello", notify: () => {} }],
    },
  ] as unknown as AgentMessage[];
  const handle = startShadow(harness, uncloneable);
  await handle.publish();
  handle.discard("turn_failed");

  assert.deepEqual(harness.records, []);
  assert.deepEqual(harness.totals, ["failed"]);
  assert.deepEqual(
    harness.errors.map((error) => error.errorCode),
    ["shadow_compile_failed"],
  );
  await harness.observer.drain();
});

test("drain waits for pending published work", async () => {
  const harness = createHarness();
  const first = harness.observer.start({
    sourceEventId: "event-1",
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventCursor: 1,
    effectiveTime: "2026-08-28T08:00:00.000+08:00",
    timezone: "Asia/Shanghai",
    compilerVersion: "context-compiler-v1",
    contextPolicyRevisionId: "context-policy-v2",
    legacyMessages: [userMessage("one")],
  });
  const second = harness.observer.start({
    sourceEventId: "event-2",
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventCursor: 2,
    effectiveTime: "2026-08-28T08:00:00.000+08:00",
    timezone: "Asia/Shanghai",
    compilerVersion: "context-compiler-v1",
    contextPolicyRevisionId: "context-policy-v2",
    legacyMessages: [userMessage("two")],
  });
  await Promise.all([first.publish(), second.publish()]);
  await harness.observer.drain();
  assert.equal(harness.records.length, 2);
});

test("drain waits for discarded compilation work without publishing it", async () => {
  let releaseCompile!: () => void;
  const compileGate = new Promise<void>((resolve) => {
    releaseCompile = resolve;
  });
  let compileFinished = false;
  const records: ContextCompilerShadowResultRecord[] = [];
  const observer = createContextShadowObserver({
    compiler: {
      async compile() {
        await compileGate;
        compileFinished = true;
        return {
          context: canonicalContext,
          diagnostics: [],
          canonicalContextHash: "a".repeat(64),
          conversationEventIds: [],
        };
      },
    },
    resultStore: {
      async createOrVerifyEquivalent(record) {
        records.push(record);
      },
    },
  });
  const handle = observer.start({
    sourceEventId: "event-1",
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventCursor: 1,
    effectiveTime: "2026-08-28T08:00:00.000+08:00",
    timezone: "Asia/Shanghai",
    compilerVersion: "context-compiler-v1",
    contextPolicyRevisionId: "context-policy-v2",
    legacyMessages: [userMessage("one")],
  });
  handle.discard("turn_failed");

  let drained = false;
  const draining = observer.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  releaseCompile();
  await draining;

  assert.equal(compileFinished, true);
  assert.deepEqual(records, []);
});
