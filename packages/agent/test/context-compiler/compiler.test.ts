import assert from "node:assert/strict";
import test from "node:test";
import type {
  ArtifactRevisionStore,
  ConversationEvent,
  ConversationEventStore,
} from "../../src/index.js";
import type { CompileContextInputV1 } from "../../src/context-compiler/index.js";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_TIMEZONE,
  buildCanonicalMemoryExtractionInput,
  buildCanonicalRequestDocument,
  buildContextManifestDocument,
  createContextCompilerV1,
  hashCanonicalRequestDocument,
  hashCanonicalValue,
} from "../../src/context-compiler/index.js";

function inbound(
  eventId: string,
  streamSeq: number,
  text: string,
  metadataValue = "a",
  attachmentRefs: string[] = [],
): ConversationEvent {
  return {
    eventId,
    accountId: "account-1",
    streamId: "stream-1",
    streamSeq,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-28T01:00:00.000Z",
    receivedAt: "2026-08-28T01:00:01.000Z",
    recordedAt: "2026-08-28T01:00:02.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: {
      channel: "weixin",
      channelMessageId: `channel-${metadataValue}`,
      senderSnapshot: { id: "user-1", displayName: metadataValue },
      text,
      attachmentRefs,
      channelMetadata: {
        schemaId: "weixin-inbound-v1",
        schemaVersion: 1,
        data: {
          effectiveTime: metadataValue,
          tapeMemory: metadataValue,
          visualContext: metadataValue,
        },
      },
    },
  };
}

function eventStore(events: ConversationEvent[]): ConversationEventStore {
  return {
    async append() {
      throw new Error("not used");
    },
    async getById(id) {
      return events.find((event) => event.eventId === id) ?? null;
    },
    async listStream(input) {
      return events
        .filter(
          (event) =>
            event.accountId === input.accountId &&
            event.streamId === input.streamId &&
            event.streamSeq > (input.afterSeq ?? 0) &&
            event.streamSeq <= (input.throughSeq ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(0, input.limit);
    },
  };
}

function existingArtifactStore(): ArtifactRevisionStore {
  return {
    async put() {
      throw new Error("not used");
    },
    async getById(artifactId) {
      return {
        artifactId,
        kind: "media_asset",
        sha256: "a".repeat(64),
        schemaVersion: 1,
        contentLocation: "external",
        storageRef: { provider: "test", key: artifactId },
        createdAt: "2026-08-28T00:00:00.000Z",
      };
    },
    async getByContent() {
      return null;
    },
  };
}

const compileInput = {
  accountId: "account-1",
  conversationStreamId: "stream-1",
  eventCursor: 1,
  compilerVersion: CONTEXT_COMPILER_VERSION,
  contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID,
  effectiveTime: "2026-08-28T09:00:00.000+08:00",
  timezone: CONTEXT_TIMEZONE,
} as const;

test("compiler ignores channel metadata and preserves unresolved attachment order", async () => {
  const first = await createContextCompilerV1({
    conversationEventStore: eventStore([inbound("event-1", 1, "hello", "first", ["b", "a"])]),
  }).compile(compileInput);
  const second = await createContextCompilerV1({
    conversationEventStore: eventStore([inbound("event-1", 1, "hello", "second", ["b", "a"])]),
  }).compile(compileInput);

  assert.deepEqual(first, second);
  assert.deepEqual(first.context.entries[0]?.attachments, [
    { sourceRef: "b", resolution: { status: "unresolved", reason: "artifact_mapping_missing" } },
    { sourceRef: "a", resolution: { status: "unresolved", reason: "artifact_mapping_missing" } },
  ]);
  const memory = buildCanonicalMemoryExtractionInput(first.context);
  assert.deepEqual(memory, {
    schemaVersion: 1,
    entries: [{ eventId: "event-1", role: "user", text: "hello" }],
  });
});

test("effective time is part of canonical identity", async () => {
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("event-1", 1, "hello")]),
  });
  const first = await compiler.compile(compileInput);
  const second = await compiler.compile({
    ...compileInput,
    effectiveTime: "2026-08-28T09:00:01.000+08:00",
  });
  assert.notEqual(first.canonicalContextHash, second.canonicalContextHash);
});

test("cursor and latest boundary exclude future and prior session facts", async () => {
  const events: ConversationEvent[] = [
    inbound("old", 1, "old"),
    { ...inbound("clear-command", 2, "/clear") },
    {
      ...inbound("boundary", 3, "unused"),
      eventType: "session_rotated",
      causationId: "clear-command",
      payload: { previousStreamId: "stream-1", reason: "user_clear" },
    },
    inbound("current", 4, "current"),
    inbound("future", 5, "future"),
  ];
  const compiler = createContextCompilerV1({ conversationEventStore: eventStore(events) });
  const compiled = await compiler.compile({ ...compileInput, eventCursor: 4 });
  assert.equal(compiled.context.sessionBoundaryEventId, "boundary");
  assert.deepEqual(
    compiled.context.entries.map((entry) => entry.eventId),
    ["current"],
  );
});

test("edit and delete operate only inside the current window", async () => {
  const events: ConversationEvent[] = [
    inbound("one", 1, "one"),
    {
      ...inbound("edit", 2, "unused"),
      eventType: "inbound_message_edited",
      payload: { targetEventId: "one", text: "edited", attachmentRefs: ["new"] },
    },
    inbound("two", 3, "two"),
    {
      ...inbound("delete", 4, "unused"),
      eventType: "inbound_message_deleted",
      payload: { targetEventId: "two" },
    },
    {
      ...inbound("dangling", 5, "unused"),
      eventType: "inbound_message_deleted",
      payload: { targetEventId: "missing" },
    },
  ];
  const compiled = await createContextCompilerV1({
    conversationEventStore: eventStore(events),
  }).compile({ ...compileInput, eventCursor: 5 });
  assert.equal(compiled.context.entries[0]?.text, "edited");
  assert.deepEqual(
    compiled.context.entries[0]?.attachments.map((attachment) => attachment.sourceRef),
    ["new"],
  );
  assert.deepEqual(
    compiled.diagnostics.map((diagnostic) => diagnostic.code),
    ["dangling_delete_target"],
  );
  assert.equal(compiled.canonicalContextHash, hashCanonicalValue(compiled.context));
});

test("a mapping resolver requires an artifact revision store up front", () => {
  assert.throws(
    () =>
      createContextCompilerV1({
        conversationEventStore: eventStore([]),
        attachmentArtifactResolver: {
          async resolve() {
            return new Map();
          },
        },
      }),
    /missing_artifact_revision_store/u,
  );
});

test("resolver cannot return refs outside the explicit event attachmentRefs", async () => {
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("one", 1, "one", "a", ["known"])]),
    attachmentArtifactResolver: {
      async resolve() {
        return new Map([["unknown", { artifactId: "artifact-1" }]]);
      },
    },
    artifactRevisionStore: existingArtifactStore(),
  });
  await assert.rejects(
    () => compiler.compile(compileInput),
    /resolver_returned_unknown_source_ref/,
  );
});

test("a mapping resolver marks resolved attachments and preserves event order", async () => {
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("one", 1, "one", "a", ["b", "mapped", "a"])]),
    attachmentArtifactResolver: {
      async resolve({ sourceRefs }) {
        const resolved = new Map(
          sourceRefs
            .filter((ref) => ref === "mapped")
            .map((ref) => [ref, { artifactId: "artifact-1", mimeType: "image/png" }]),
        );
        return resolved;
      },
    },
    artifactRevisionStore: existingArtifactStore(),
  });
  const compiled = await compiler.compile(compileInput);
  assert.deepEqual(compiled.context.entries[0]?.attachments, [
    { sourceRef: "b", resolution: { status: "unresolved", reason: "artifact_mapping_missing" } },
    {
      sourceRef: "mapped",
      resolution: { status: "resolved", artifactId: "artifact-1", mimeType: "image/png" },
    },
    { sourceRef: "a", resolution: { status: "unresolved", reason: "artifact_mapping_missing" } },
  ]);
});

test("a resolved attachment must reference an existing immutable Artifact revision", async () => {
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("one", 1, "one", "a", ["mapped"])]),
    attachmentArtifactResolver: {
      async resolve() {
        return new Map([["mapped", { artifactId: "missing" }]]);
      },
    },
    artifactRevisionStore: {
      ...existingArtifactStore(),
      async getById() {
        return null;
      },
    },
  });
  await assert.rejects(() => compiler.compile(compileInput), /resolved_artifact_not_found/u);
});

test("memory extraction input is invariant to metadata and derived from canonical entries", async () => {
  const first = await createContextCompilerV1({
    conversationEventStore: eventStore([inbound("event-1", 1, "hello", "first", ["b"])]),
  }).compile(compileInput);
  const second = await createContextCompilerV1({
    conversationEventStore: eventStore([inbound("event-1", 1, "hello", "second", ["b"])]),
  }).compile(compileInput);

  const firstMemory = buildCanonicalMemoryExtractionInput(first.context);
  const secondMemory = buildCanonicalMemoryExtractionInput(second.context);
  assert.deepEqual(firstMemory, secondMemory);
  assert.equal(hashCanonicalValue(firstMemory), hashCanonicalValue(secondMemory));
  assert.equal(first.canonicalContextHash, second.canonicalContextHash);
  // The extraction input never carries attachments, runtime time, or metadata.
  assert.deepEqual(firstMemory, {
    schemaVersion: 1,
    entries: [{ eventId: "event-1", role: "user", text: "hello" }],
  });
});

test("compiler rejects invalid compile identities instead of guessing", async () => {
  const compiler = createContextCompilerV1({ conversationEventStore: eventStore([]) });
  const cases = [
    { ...compileInput, accountId: "  " },
    { ...compileInput, conversationStreamId: "" },
    { ...compileInput, eventCursor: 0 },
    { ...compileInput, eventCursor: 2.5 },
    { ...compileInput, compilerVersion: "context-compiler-v2" },
    { ...compileInput, contextPolicyRevisionId: "context-policy-v3" },
    { ...compileInput, timezone: "UTC" },
    { ...compileInput, effectiveTime: "not-a-time" },
  ];
  for (const input of cases) {
    await assert.rejects(
      () => compiler.compile(input as CompileContextInputV1),
      /invalid_compiler_identity|invalid_event_cursor|unsupported_compiler_version|unsupported_context_policy_revision|invalid_runtime_context/,
    );
  }
});

test("policy v2 requires the run and artifact stores up front", async () => {
  const noRunStore = createContextCompilerV1({ conversationEventStore: eventStore([]) });
  await assert.rejects(
    () => noRunStore.compile({ ...compileInput, contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2 }),
    /missing_run_store/u,
  );
  const noArtifactStore = createContextCompilerV1({
    conversationEventStore: eventStore([]),
    agentRunStore: {
      async append() {
        throw new Error("not used");
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
    },
  });
  await assert.rejects(
    () => noArtifactStore.compile({ ...compileInput, contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2 }),
    /missing_artifact_revision_store/u,
  );
});

test("compiler fails closed when the store page ends before the cursor", async () => {
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("one", 1, "one")]),
  });
  await assert.rejects(
    () => compiler.compile({ ...compileInput, eventCursor: 2 }),
    /event_cursor_not_found/,
  );
});

type AgentRunEventFixture = import("../../src/index.js").AgentRunEvent;

function runEvent(
  runId: string,
  runSeq: number,
  eventType: string,
  payload: unknown,
): AgentRunEventFixture {
  return {
    eventId: `${runId}:${runSeq}`,
    runId,
    runSeq,
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventType,
    schemaVersion: 1,
    occurredAt: "2026-08-28T01:00:30.000Z",
    recordedAt: "2026-08-28T01:00:31.000Z",
    causationId: "trigger-1",
    correlationId: "trigger-1",
    payload,
  } as AgentRunEventFixture;
}

function textArtifact(artifactId: string, text: string) {
  return {
    artifactId,
    kind: "model_response" as const,
    sha256: "a".repeat(64),
    schemaVersion: 1,
    contentLocation: "inline" as const,
    inlineJson: { role: "assistant", content: [{ type: "text", text }] },
    createdAt: "2026-08-28T01:00:31.000Z",
  };
}

const runStoreFixture = (runEvents: AgentRunEventFixture[]) => ({
  async append() {
    throw new Error("not used");
  },
  async getById() {
    return null;
  },
  async listRun() {
    return [];
  },
  async listRunEventsByStream() {
    return runEvents;
  },
});

test("policy v2 merges prior terminal run facts at their trigger position", async () => {
  const runEvents = [
    runEvent("run-1", 1, "run_started", { runKind: "chat", triggerEventId: "one" }),
    runEvent("run-1", 2, "model_call_completed", {
      callId: "call-1",
      round: 1,
      manifestId: "m",
      responseArtifactId: "artifact-1",
    }),
    runEvent("run-1", 3, "run_completed", { rounds: 1 }),
  ];
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([
      inbound("one", 1, "hello"),
      inbound("two", 2, "again"),
    ]),
    agentRunStore: runStoreFixture(runEvents),
    artifactRevisionStore: {
      async put() {
        throw new Error("not used");
      },
      async getById(artifactId: string) {
        return artifactId === "artifact-1" ? textArtifact(artifactId, "reply to hello") : null;
      },
      async getByContent() {
        return null;
      },
    } as never,
  });
  const compiled = await compiler.compile({
    ...compileInput,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
    eventCursor: 2,
  });
  assert.deepEqual(
    compiled.context.entries.map((entry) => [entry.role, entry.text]),
    [
      ["user", "hello"],
      ["assistant", "reply to hello"],
      ["user", "again"],
    ],
  );
  assert.equal(compiled.context.entries[1]?.runId, "run-1");
  assert.equal(compiled.context.entries[1]?.runSeq, 2);
  assert.deepEqual(compiled.context.coverage, {
    conversationFacts: true,
    assistantRunFacts: true,
    toolRunFacts: true,
    memoryFacts: false,
    immutableMediaArtifacts: false,
  });
  assert.deepEqual(compiled.conversationEventIds, ["one", "two"]);
  assert.deepEqual(compiled.runEntrySourceIds, ["run-1:2"]);
});

test("policy v2 excludes pre-boundary runs from the session window", async () => {
  const runEvents = [
    runEvent("run-old", 1, "run_started", { runKind: "chat", triggerEventId: "old" }),
    runEvent("run-old", 2, "model_call_completed", {
      callId: "call-old",
      round: 1,
      manifestId: "m",
      responseArtifactId: "artifact-1",
    }),
    runEvent("run-old", 3, "run_completed", { rounds: 1 }),
  ];
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([
      inbound("old", 1, "before clear"),
      {
        ...inbound("clear", 2, "/clear"),
        eventType: "session_rotated",
        payload: { previousStreamId: "stream-1", reason: "user_clear" },
      },
      inbound("new", 3, "after clear"),
    ]),
    agentRunStore: runStoreFixture(runEvents),
    artifactRevisionStore: {
      async put() {
        throw new Error("not used");
      },
      async getById(artifactId: string) {
        return textArtifact(artifactId, "pre-clear reply");
      },
      async getByContent() {
        return null;
      },
    } as never,
  });
  const compiled = await compiler.compile({
    ...compileInput,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
    eventCursor: 3,
  });
  assert.deepEqual(
    compiled.context.entries.map((entry) => entry.text),
    ["after clear"],
  );
  assert.deepEqual(compiled.runEntrySourceIds, []);
});

test("metadata-only variation does not change the v2 canonical hash", async () => {
  const build = (metadataValue: string) =>
    createContextCompilerV1({
      conversationEventStore: eventStore([
        inbound("event-1", 1, "hello", metadataValue),
        inbound("two", 2, "again", metadataValue),
      ]),
      agentRunStore: runStoreFixture([
        runEvent("run-1", 1, "run_started", { runKind: "chat", triggerEventId: "event-1" }),
        runEvent("run-1", 2, "model_call_completed", {
          callId: "call-1",
          round: 1,
          manifestId: "m",
          responseArtifactId: "artifact-1",
        }),
        runEvent("run-1", 3, "run_completed", { rounds: 1 }),
      ]),
      artifactRevisionStore: {
        async put() {
          throw new Error("not used");
        },
        async getById(artifactId: string) {
          return textArtifact(artifactId, "reply");
        },
        async getByContent() {
          return null;
        },
      } as never,
    }).compile({ ...compileInput, contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2 });

  const first = await build("first");
  const second = await build("second");
  assert.equal(first.canonicalContextHash, second.canonicalContextHash);
});

test("policy v2 reads oversized entry artifacts back through the content sink", async () => {
  const runEvents = [
    runEvent("run-1", 1, "run_started", { runKind: "chat", triggerEventId: "one" }),
    runEvent("run-1", 2, "model_call_completed", {
      callId: "call-1",
      round: 1,
      manifestId: "m",
      responseArtifactId: "artifact-big",
    }),
    runEvent("run-1", 3, "run_completed", { rounds: 1 }),
  ];
  const storedDocs = new Map<string, string>([
    [
      "canonical_request/big.json",
      JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "oversized reply" }],
      }),
    ],
  ]);
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("one", 1, "hello")]),
    agentRunStore: runStoreFixture(runEvents),
    artifactRevisionStore: {
      async put() {
        throw new Error("not used");
      },
      async getById(artifactId: string) {
        // Oversized artifact: metadata row only, content lives behind the sink.
        return {
          artifactId,
          kind: "model_response" as const,
          sha256: "a".repeat(64),
          schemaVersion: 1,
          contentLocation: "external" as const,
          storageRef: { provider: "local-fact-ledger", key: "canonical_request/big.json" },
          createdAt: "2026-08-28T01:00:31.000Z",
        };
      },
      async getByContent() {
        return null;
      },
    } as never,
    contentSink: {
      async put() {
        throw new Error("not used");
      },
      async get(key: string) {
        return storedDocs.has(key) ? new TextEncoder().encode(storedDocs.get(key)!) : null;
      },
    },
  });
  const compiled = await compiler.compile({
    ...compileInput,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
  });
  assert.deepEqual(
    compiled.context.entries.map((entry) => [entry.role, entry.text]),
    [
      ["user", "hello"],
      ["assistant", "oversized reply"],
    ],
  );
  assert.deepEqual(compiled.diagnostics, []);
});

test("context manifest document is deterministic and pins the round-1 request hash", () => {
  const requestDoc = buildCanonicalRequestDocument({
    runId: "run-1",
    round: 1,
    modelRevisionId: "model-config-revision-v1:abc",
    system: "system prompt",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    tools: [{ name: "use_skill", description: "load skill", parameters: {} }],
    trim: {
      trimLevel: 0,
      originalTokens: 100,
      trimmedTokens: 100,
      droppedMessages: 0,
      fixedOverheadTokens: 20,
    },
  });
  const manifestInput = {
    accountId: "account-1",
    runId: "run-1",
    manifestId: "context-manifest-v1:abc",
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
    conversationEventIds: ["e1", "e2"],
    runEventIds: ["re1"],
    modelRevisionId: "model-config-revision-v1:abc",
    promptRevisionId: "prompt-revision-v1:abc",
    skillRevisionIds: [],
    toolRevisionIds: ["tool-revision-v1:abc"],
    effectiveTime: "2026-08-28T09:00:00.000+08:00",
    timezone: CONTEXT_TIMEZONE,
    trimDecision: requestDoc.trim,
    canonicalRequestHash: hashCanonicalRequestDocument(requestDoc),
  };
  const manifest = buildContextManifestDocument(manifestInput);
  assert.equal(manifest.memoryEventWatermark, "unavailable-v1");
  assert.equal(manifest.summaryArtifactIds.length, 0);
  assert.deepEqual(manifest.conversationEventIds, ["e1", "e2"]);
  assert.deepEqual(manifest.runEventIds, ["re1"]);
  assert.deepEqual(manifest, buildContextManifestDocument(manifestInput));
});
