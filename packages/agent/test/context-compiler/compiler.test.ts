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
  CONTEXT_TIMEZONE,
  buildCanonicalMemoryExtractionInput,
  createContextCompilerV1,
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
    { ...compileInput, contextPolicyRevisionId: "context-policy-v2" },
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

test("compiler fails closed when the store page ends before the cursor", async () => {
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("one", 1, "one")]),
  });
  await assert.rejects(
    () => compiler.compile({ ...compileInput, eventCursor: 2 }),
    /event_cursor_not_found/,
  );
});
