import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunEvent, ConversationEvent } from "../../src/index.js";
import {
  AGENT_RUN_EVENT_TYPE,
  CONVERSATION_EVENT_TYPE,
} from "../../src/shared/fact-ledger/contracts.js";
import {
  extractRound1TriggerPrompt,
  reduceRunFacts,
  type ReduceRunFactsInput,
} from "../../src/context-compiler/run-facts.js";
import { compareCanonicalEntries } from "../../src/context-compiler/run-facts.js";

const TRIGGER_RUN_ID = "run-v1:trigger";

function runEvent(
  runId: string,
  runSeq: number,
  eventType: AgentRunEvent["eventType"],
  payload: unknown,
  extras: Partial<AgentRunEvent> = {},
): AgentRunEvent {
  return {
    eventId: `${runId}:${runSeq}`,
    runId,
    runSeq,
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventType,
    schemaVersion: 1,
    occurredAt: "2026-08-30T10:00:00.000Z",
    recordedAt: "2026-08-30T10:00:01.000Z",
    causationId: undefined,
    correlationId: "stream-1",
    payload: payload as AgentRunEvent["payload"],
    ...extras,
  } as AgentRunEvent;
}

/** trigger run（无 triggerEventId）：run_started → round-1 request → assistant → run_completed */
function triggerRunChain(round1RequestArtifactId: string): AgentRunEvent[] {
  return [
    runEvent(TRIGGER_RUN_ID, 1, AGENT_RUN_EVENT_TYPE.RUN_STARTED, {
      runKind: "chat",
      anchorStreamSeq: 7,
    }),
    runEvent(TRIGGER_RUN_ID, 2, AGENT_RUN_EVENT_TYPE.MODEL_CALL_STARTED, {
      callId: "call-1",
      round: 1,
      manifestId: "manifest-1",
      requestArtifactId: round1RequestArtifactId,
    }),
    runEvent(TRIGGER_RUN_ID, 3, AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED, {
      callId: "call-1",
      responseArtifactId: "response-artifact",
    }),
    runEvent(TRIGGER_RUN_ID, 4, AGENT_RUN_EVENT_TYPE.RUN_COMPLETED, { rounds: 1 }),
  ];
}

const ROUND1_REQUEST_DOC = {
  round: 1,
  system: "system prompt",
  messages: [
    {
      role: "user",
      timestamp: 1,
      content: [{ type: "text", text: "older user turn" }],
    },
    {
      role: "trigger",
      timestamp: 2,
      meta: { kind: "pulse" },
      content: [
        { type: "text", text: "[当前时间: 2026-08-30 18:00]\n<memory>…</memory>\n" },
        { type: "text", text: "主动关怀一下用户" },
      ],
    },
  ],
  tools: [],
  trim: {
    trimLevel: 0,
    originalTokens: 10,
    trimmedTokens: 10,
    droppedMessages: 0,
    fixedOverheadTokens: 0,
  },
};

function reduceWithTriggerChain(
  overrides: Partial<ReduceRunFactsInput> = {},
): ReturnType<typeof reduceRunFacts> {
  return reduceRunFacts({
    runEvents: triggerRunChain("request-artifact"),
    triggerStreamSeqByEventId: new Map(),
    artifactTextById: new Map([["response-artifact", "你好呀"]]),
    policyV3: true,
    triggerRunAnchors: new Map([[TRIGGER_RUN_ID, { streamSeq: 7, anchored: true }]]),
    round1RequestTextById: new Map([
      ["request-artifact", extractRound1TriggerPrompt(ROUND1_REQUEST_DOC) ?? ""],
    ]),
    toolArgumentsJsonById: new Map(),
    ...overrides,
  });
}

test("v3 derives the trigger entry from the round-1 request, placed before the reply", () => {
  const { entries, diagnostics } = reduceWithTriggerChain();

  assert.deepEqual(
    diagnostics,
    [],
    "a fully evidenced trigger run produces no diagnostics",
  );
  const roles = entries.map((entry) => entry.role);
  assert.deepEqual(roles, ["trigger", "assistant"]);

  const triggerEntry = entries[0];
  assert.equal(triggerEntry.role, "trigger");
  assert.equal(triggerEntry.streamSeq, 7, "streamSeq comes from the anchorStreamSeq anchor");
  assert.equal(triggerEntry.runId, TRIGGER_RUN_ID);
  // 完整组装文本：包含时间/记忆注入，不剥离（§7.1）。
  assert.ok(triggerEntry.text.includes("[当前时间: 2026-08-30 18:00]"));
  assert.ok(triggerEntry.text.includes("<memory>…</memory>"));
  assert.ok(triggerEntry.text.endsWith("主动关怀一下用户"));

  // 同一锚点内 trigger（runSeq 最小）排在回复之前。
  const sorted = [...entries].sort(compareCanonicalEntries);
  assert.equal(sorted[0].role, "trigger");
});

test("v2 input ignores trigger runs entirely (v2 hash anchor unchanged)", () => {
  const reduction = reduceRunFacts({
    runEvents: triggerRunChain("request-artifact"),
    triggerStreamSeqByEventId: new Map(),
    artifactTextById: new Map([["response-artifact", "你好呀"]]),
  });
  assert.deepEqual(reduction.entries, []);
  assert.deepEqual(reduction.diagnostics, []);
});

test("missing round-1 request artifact → empty trigger entry + diagnostic (no guessing)", () => {
  const { entries, diagnostics } = reduceWithTriggerChain({
    round1RequestTextById: new Map(),
  });
  const triggerEntry = entries.find((entry) => entry.role === "trigger");
  assert.ok(triggerEntry);
  assert.equal(triggerEntry.text, "");
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["run_request_artifact_missing"],
  );
});

test("missing anchor → local-clock approximation with run_anchor_missing diagnostic", () => {
  const { entries, diagnostics } = reduceWithTriggerChain({
    triggerRunAnchors: new Map([[TRIGGER_RUN_ID, { streamSeq: 3, anchored: false }]]),
  });
  const triggerEntry = entries.find((entry) => entry.role === "trigger");
  assert.ok(triggerEntry);
  assert.equal(triggerEntry.streamSeq, 3);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    ["run_anchor_missing"],
  );
});

test("no anchor at all → trigger run contributes nothing", () => {
  const { entries, diagnostics } = reduceWithTriggerChain({
    triggerRunAnchors: new Map(),
  });
  assert.deepEqual(entries, []);
  assert.deepEqual(diagnostics, []);
});

test("interrupted trigger runs never produce entries", () => {
  const runEvents = [
    ...triggerRunChain("request-artifact").slice(0, 3),
    runEvent(TRIGGER_RUN_ID, 4, AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED, { reason: "aborted" }),
  ];
  const { entries } = reduceRunFacts({
    runEvents,
    triggerStreamSeqByEventId: new Map(),
    artifactTextById: new Map(),
    policyV3: true,
    triggerRunAnchors: new Map([[TRIGGER_RUN_ID, { streamSeq: 7, anchored: true }]]),
    round1RequestTextById: new Map([["request-artifact", "prompt"]]),
  });
  assert.deepEqual(entries, []);
});

test("extractRound1TriggerPrompt takes the LAST user/trigger message", () => {
  const prompt = extractRound1TriggerPrompt(ROUND1_REQUEST_DOC);
  assert.ok(prompt?.includes("主动关怀一下用户"));
  assert.ok(!prompt?.includes("older user turn"));
  assert.equal(extractRound1TriggerPrompt({ messages: "nope" }), undefined);
  assert.equal(extractRound1TriggerPrompt(null), undefined);
});

test("v3 tool entries carry callId/toolName/toolArguments/toolError for pairing", () => {
  const runEvents = [
    runEvent("run-v1:tool", 1, AGENT_RUN_EVENT_TYPE.RUN_STARTED, { runKind: "chat" }),
    runEvent("run-v1:tool", 2, AGENT_RUN_EVENT_TYPE.MODEL_CALL_STARTED, {
      callId: "call-1",
      round: 1,
      manifestId: "m",
      requestArtifactId: "req",
    }),
    runEvent("run-v1:tool", 3, AGENT_RUN_EVENT_TYPE.TOOL_CALL_REQUESTED, {
      toolCallId: "tc-1",
      toolName: "weather",
      toolRevisionId: "tool-rev-1",
      argumentsArtifactId: "args-artifact",
    }),
    runEvent("run-v1:tool", 4, AGENT_RUN_EVENT_TYPE.TOOL_CALL_FAILED, {
      toolCallId: "tc-1",
      error: "tool_timeout",
      errorArtifactId: "error-artifact",
    }),
    runEvent("run-v1:tool", 5, AGENT_RUN_EVENT_TYPE.RUN_COMPLETED, { rounds: 1 }),
  ];
  const { entries } = reduceRunFacts({
    runEvents,
    triggerStreamSeqByEventId: new Map(),
    artifactTextById: new Map([["error-artifact", "boom"]]),
    policyV3: true,
    triggerRunAnchors: new Map([["run-v1:tool", { streamSeq: 1, anchored: true }]]),
    round1RequestTextById: new Map([["req", "prompt"]]),
    toolArgumentsJsonById: new Map([["args-artifact", '{"city":"上海"}']]),
  });
  const toolEntry = entries.find((entry) => entry.role === "tool");
  assert.ok(toolEntry);
  assert.equal(toolEntry.callId, "tc-1");
  assert.equal(toolEntry.toolName, "weather");
  assert.equal(toolEntry.toolArguments, '{"city":"上海"}');
  assert.equal(toolEntry.toolError, true);
});
