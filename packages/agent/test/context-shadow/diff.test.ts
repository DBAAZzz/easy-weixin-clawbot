import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import type { AgentMessage, CanonicalContextV1 } from "../../src/index.js";
import {
  diffCanonicalAndLegacy,
  normalizeLegacyContext,
} from "../../src/engine/context-shadow/index.js";

const canonical: CanonicalContextV1 = {
  schemaVersion: 1,
  compilerVersion: "context-compiler-v1",
  contextPolicyRevisionId: "context-policy-v1",
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
      attachments: [
        {
          sourceRef: "attachment-1",
          resolution: { status: "unresolved", reason: "artifact_mapping_missing" },
        },
      ],
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

test("legacy normalizer classifies wrappers without changing canonical input", () => {
  const messages: AgentMessage[] = [
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      content: [
        {
          type: MESSAGE_CONTENT_TYPE.TEXT,
          text: "[当前时间: 2026]\n<memory>secret</memory>\n[引用: display]\nhello",
        },
      ],
    },
  ];
  const legacy = normalizeLegacyContext(messages);
  const diff = diffCanonicalAndLegacy(canonical, legacy);
  assert.equal(diff.counts.match_user_text, 1);
  assert.equal(diff.counts.legacy_user_has_runtime_time, 1);
  assert.equal(diff.counts.legacy_user_has_tape_memory, 1);
  assert.equal(diff.counts.legacy_quoted_display_only, 1);
  assert.equal(diff.counts.canonical_unresolved_attachment, 1);
  assert.equal(diff.counts.unclassified_difference, 0);
  assert.equal("text" in diff, false);
});

test("unknown user difference is low-cardinality and contains no body", () => {
  const legacy = normalizeLegacyContext([
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "different" }],
    },
  ]);
  const diff = diffCanonicalAndLegacy(canonical, legacy);
  assert.equal(diff.counts.unclassified_difference, 1);
  assert.doesNotMatch(JSON.stringify(diff), /different|hello/);
});

test("assistant and tool entries are expected legacy-only gaps", () => {
  const legacy = normalizeLegacyContext([
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "hello" }],
    },
    {
      role: MESSAGE_ROLE.ASSISTANT,
      timestamp: 2,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "reply" }],
    },
    {
      role: MESSAGE_ROLE.TOOL_RESULT,
      timestamp: 3,
      toolCallId: "call-1",
      toolName: "test-tool",
      isError: false,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "tool" }],
    },
  ]);
  const diff = diffCanonicalAndLegacy(canonical, legacy);
  assert.equal(diff.counts.match_user_text, 1);
  assert.equal(diff.counts.legacy_only_assistant_entry, 1);
  assert.equal(diff.counts.legacy_only_tool_entry, 1);
  assert.equal(diff.counts.unclassified_difference, 0);
  assert.doesNotMatch(JSON.stringify(diff), /reply|tool"/);
});

test("assistant entries already covered by canonical facts are not legacy-only", () => {
  const withOutbound: CanonicalContextV1 = {
    ...canonical,
    entries: [
      ...canonical.entries,
      {
        eventId: "event-2",
        streamSeq: 2,
        role: "assistant",
        occurredAt: "2026-08-28T00:00:01.000Z",
        text: "reply",
        attachments: [],
      },
    ],
  };
  const legacy = normalizeLegacyContext([
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "hello" }],
    },
    {
      role: MESSAGE_ROLE.ASSISTANT,
      timestamp: 2,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "reply" }],
    },
    {
      role: MESSAGE_ROLE.ASSISTANT,
      timestamp: 3,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "extra" }],
    },
  ]);
  const diff = diffCanonicalAndLegacy(withOutbound, legacy);
  // Two legacy assistant entries minus the one canonical outbound fact.
  assert.equal(diff.counts.legacy_only_assistant_entry, 1);
  assert.doesNotMatch(JSON.stringify(diff), /extra|reply/);
});

test("visual fallback wrappers are classified without entering canonical content", () => {
  const legacy = normalizeLegacyContext([
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      visualContext: [
        {
          provider: "vision",
          modelId: "vision-1",
          generatedAt: "2026-08-28T00:00:00.000Z",
          summary: "summary",
          ocrText: [],
          objects: [],
        },
      ],
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "hello" }],
    },
  ] as AgentMessage[]);
  const diff = diffCanonicalAndLegacy(canonical, legacy);
  assert.equal(diff.counts.legacy_user_has_visual_fallback, 1);
  assert.equal(diff.counts.match_user_text, 1);
  assert.equal(diff.counts.unclassified_difference, 0);
});

test("same texts in a different order count as an order difference", () => {
  const reordered: CanonicalContextV1 = {
    ...canonical,
    sessionBoundaryEventId: "boundary-1",
    entries: [
      { ...canonical.entries[0]!, eventId: "event-2", streamSeq: 2, text: "second" },
      { ...canonical.entries[0]!, eventId: "event-3", streamSeq: 3, text: "third" },
    ],
  };
  const legacy = normalizeLegacyContext([
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "third" }],
    },
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 2,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "second" }],
    },
  ]);
  const diff = diffCanonicalAndLegacy(reordered, legacy);
  assert.equal(diff.counts.entry_order_difference, 1);
  assert.equal(diff.counts.unclassified_difference, 0);
});

test("legacy entries cut by a session boundary are explained, not unclassified", () => {
  const bounded: CanonicalContextV1 = {
    ...canonical,
    sessionBoundaryEventId: "boundary-1",
  };
  const legacy = normalizeLegacyContext([
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 1,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "before-clear" }],
    },
    {
      role: MESSAGE_ROLE.USER,
      timestamp: 2,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: "hello" }],
    },
  ]);
  const diff = diffCanonicalAndLegacy(bounded, legacy);
  // Positional comparison matches nothing, so both unmatched legacy user
  // entries are absorbed by the boundary category.
  assert.equal(diff.counts.session_boundary_difference, 2);
  assert.equal(diff.counts.unclassified_difference, 0);
});
