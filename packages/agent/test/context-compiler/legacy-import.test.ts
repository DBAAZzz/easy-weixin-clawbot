import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "../../src/llm/types.js";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import { parseAppendConversationEventInput } from "../../src/shared/fact-ledger/contracts.js";
import { reduceConversationEvents } from "../../src/context-compiler/conversation-reducer.js";
import { createContextCompilerV1 } from "../../src/context-compiler/compiler.js";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V3,
  CONTEXT_POLICY_REVISION_ID_V4,
  CONTEXT_TIMEZONE,
} from "../../src/context-compiler/types.js";
import { buildCanonicalHistory } from "../../src/engine/context-build/canonical.js";
import { projectionWriteModeFor, resetProjectionWriteModeResolver, setProjectionWriteModeResolver } from "../../src/ports/projection-write.js";

// ── fixtures ─────────────────────────────────────────────────────────

function conversationEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "legacy-import-v1:abc",
    eventType: "legacy_transcript_imported",
    schemaVersion: 1,
    accountId: "account-1",
    streamId: "conv-1",
    occurredAt: "2026-09-01T08:00:00.000Z",
    receivedAt: "2026-09-01T08:00:00.000Z",
    actor: { kind: "system" },
    payload: {
      source: "messages_projection",
      reconstructability: "partial",
      boundaryMessageSeq: 4,
      omittedEntryCount: 0,
      entries: [
        {
          sourceMessageSeq: 1,
          role: "user",
          occurredAt: "2026-08-01T08:00:00.000Z",
          text: "[当前时间: 2026-08-01 16:00]\n<memory>…</memory>\n你好",
        },
        {
          sourceMessageSeq: 2,
          role: "assistant",
          occurredAt: "2026-08-01T08:00:05.000Z",
          text: "你好！",
        },
        {
          sourceMessageSeq: 3,
          role: "assistant",
          occurredAt: "2026-08-01T08:01:00.000Z",
          text: "",
        },
        {
          sourceMessageSeq: 4,
          role: "tool",
          occurredAt: "2026-08-01T08:01:01.000Z",
          text: "天气晴",
          callId: "call-1",
          toolName: "weather",
          toolArguments: '{"city":"上海"}',
        },
      ],
    },
    ...overrides,
  };
}

function inboundEvent(streamSeq: number, text: string): Record<string, unknown> {
  return {
    eventId: `inbound-${streamSeq}`,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    accountId: "account-1",
    streamId: "conv-1",
    streamSeq,
    occurredAt: "2026-09-01T09:00:00.000Z",
    receivedAt: "2026-09-01T09:00:00.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { channel: "weixin", text, attachmentRefs: [] },
  };
}

// fake store for the compiler-level test
function eventStore(events: unknown[]) {
  return {
    async append() {
      throw new Error("not used");
    },
    async getById() {
      return null;
    },
    async listStream() {
      return events;
    },
    async getStreamHeadSeq() {
      return events.length;
    },
  };
}

// ── contract ─────────────────────────────────────────────────────────

test("legacy_transcript_imported 契约接受 opaque 批量条目并拒绝未知字段", () => {
  const parsed = parseAppendConversationEventInput(conversationEnvelope());
  assert.equal(parsed.eventType, "legacy_transcript_imported");

  assert.throws(() =>
    parseAppendConversationEventInput(
      conversationEnvelope({
        payload: {
          source: "messages_projection",
          reconstructability: "full",
          boundaryMessageSeq: 1,
          omittedEntryCount: 0,
          entries: [],
        },
      }),
    ),
  );
});

test("legacy_transcript_imported 契约拒绝 role 与超长 text", () => {
  assert.throws(() =>
    parseAppendConversationEventInput(
      conversationEnvelope({
        payload: {
          source: "messages_projection",
          reconstructability: "partial",
          boundaryMessageSeq: 1,
          omittedEntryCount: 0,
          entries: [{ sourceMessageSeq: 1, role: "system", occurredAt: "2026-08-01T08:00:00.000Z", text: "x" }],
        },
      }),
    ),
  );
  assert.throws(() =>
    parseAppendConversationEventInput(
      conversationEnvelope({
        payload: {
          source: "messages_projection",
          reconstructability: "partial",
          boundaryMessageSeq: 1,
          omittedEntryCount: 0,
          entries: [
            {
              sourceMessageSeq: 1,
              role: "user",
              occurredAt: "2026-08-01T08:00:00.000Z",
              text: "x".repeat(65_537),
            },
          ],
        },
      }),
    ),
  );
});

// ── reducer ──────────────────────────────────────────────────────────

test("reducer 将 legacy 批量条目派生为 seq 0 + 合成 runId 的先置条目", () => {
  const events = [
    inboundEvent(1, "hi"),
    conversationEnvelope({ streamSeq: 2 }),
  ] as never[];
  const reduced = reduceConversationEvents(events, 2);
  assert.equal(reduced.sessionBoundaryEventId, undefined);
  // legacy first, then facts
  assert.deepEqual(
    reduced.entries.map((entry) => [entry.role, entry.streamSeq]),
    [
      ["user", 0],
      ["assistant", 0],
      ["assistant", 0],
      ["tool", 0],
      ["user", 1],
    ],
  );
  const legacy = reduced.entries[0];
  assert.equal(legacy.reconstructability, "partial");
  assert.equal(legacy.sourceMessageSeq, 1);
  assert.equal(legacy.runId, "legacy-import-v1:abc");
  assert.equal(legacy.runSeq, 1);
  // deterministic per-entry id
  const toolEntry = reduced.entries[3];
  assert.equal(toolEntry.callId, "call-1");
  assert.equal(toolEntry.toolName, "weather");
  assert.equal(toolEntry.toolArguments, '{"city":"上海"}');
});

test("reducer 在窗口内存在 session boundary 时丢弃 legacy 条目", () => {
  const boundary = {
    eventId: "boundary-1",
    eventType: "session_rotated",
    schemaVersion: 1,
    accountId: "account-1",
    streamId: "conv-1",
    streamSeq: 2,
    occurredAt: "2026-09-01T09:00:00.000Z",
    receivedAt: "2026-09-01T09:00:00.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { previousStreamId: "conv-1", reason: "user_clear" },
  };
  const events = [
    inboundEvent(1, "hi"),
    boundary,
    inboundEvent(3, "新会话"),
    conversationEnvelope({ streamSeq: 4 }),
  ] as never[];
  const reduced = reduceConversationEvents(events, 4);
  assert.ok(reduced.sessionBoundaryEventId);
  assert.ok(reduced.entries.every((entry) => entry.reconstructability === undefined));
});

// ── compiler policy gating ───────────────────────────────────────────

function emptyRunStore() {
  return {
    async listRunEventsByStream() {
      return [];
    },
  };
}

function emptyArtifactStore() {
  return {
    async getById() {
      return null;
    },
  };
}

function compileInput(policy: string) {
  return {
    accountId: "account-1",
    conversationStreamId: "conv-1",
    eventCursor: 9,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: policy,
    effectiveTime: "2026-09-01T10:00:00.000Z",
    timezone: CONTEXT_TIMEZONE,
  };
}

test("policy v4 编译包含 legacy 条目；v3 输出过滤 legacy 条目（回归锚）", async () => {
  const events = [inboundEvent(1, "hi"), conversationEnvelope({ streamSeq: 2 })];
  const compilerV4 = createContextCompilerV1({
    conversationEventStore: eventStore(events) as never,
    agentRunStore: emptyRunStore() as never,
    artifactRevisionStore: emptyArtifactStore() as never,
  });
  const compiledV4 = await compilerV4.compile({ ...compileInput(CONTEXT_POLICY_REVISION_ID_V4), eventCursor: 2 });
  assert.ok(compiledV4.context.entries.some((entry) => entry.reconstructability === "partial"));

  const compilerV3 = createContextCompilerV1({
    conversationEventStore: eventStore(events) as never,
    agentRunStore: emptyRunStore() as never,
    artifactRevisionStore: emptyArtifactStore() as never,
  });
  const compiledV3 = await compilerV3.compile({ ...compileInput(CONTEXT_POLICY_REVISION_ID_V3), eventCursor: 2 });
  assert.ok(compiledV3.context.entries.every((entry) => entry.reconstructability === undefined));
  // v3 sees only the fact entry
  assert.equal(compiledV3.context.entries.length, 1);
});

// ── canonical build: legacy tool pairing ─────────────────────────────

test("canonical build 重展开 legacy assistant+tool 条目为有效配对", async () => {
  const events = [conversationEnvelope({ streamSeq: 1 })];
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore(events) as never,
    agentRunStore: emptyRunStore() as never,
    artifactRevisionStore: emptyArtifactStore() as never,
  });
  const build = await buildCanonicalHistory({
    accountId: "account-1",
    compileContext: () =>
      compiler.compile({ ...compileInput(CONTEXT_POLICY_REVISION_ID_V4), eventCursor: 1 }),
    supportsImageInput: false,
  });

  const assistant = build.messages.find(
    (message: AgentMessage) =>
      message.role === MESSAGE_ROLE.ASSISTANT &&
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL),
  ) as AgentMessage | undefined;
  assert.ok(assistant, "legacy assistant keeps its tool_call block");
  const toolResult = build.messages.find((message: AgentMessage) => message.role === MESSAGE_ROLE.TOOL_RESULT) as AgentMessage | undefined;
  assert.ok(toolResult);
  assert.equal(toolResult.toolName, "weather");
  assert.equal(toolResult.isError, false);
  // legacy user entry keeps the opaque assembled text
  const user = build.messages.find((message: AgentMessage) => message.role === MESSAGE_ROLE.USER) as AgentMessage | undefined;
  assert.ok(user);
  assert.match(JSON.stringify(user.content), /<memory>/);
});

// ── projection write mode resolver ───────────────────────────────────

test("projectionWriteModeFor 缺省 prompt_shaped，解析器异常时降级", () => {
  assert.equal(projectionWriteModeFor("any-account"), "prompt_shaped");

  setProjectionWriteModeResolver((accountId) =>
    accountId === "clean-account" ? "clean" : "prompt_shaped",
  );
  assert.equal(projectionWriteModeFor("clean-account"), "clean");

  setProjectionWriteModeResolver(() => {
    throw new Error("resolver broken");
  });
  assert.equal(projectionWriteModeFor("clean-account"), "prompt_shaped");

  resetProjectionWriteModeResolver();
  assert.equal(projectionWriteModeFor("clean-account"), "prompt_shaped");
});
