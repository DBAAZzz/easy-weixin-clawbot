import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunEvent, ConversationEvent } from "../../src/index.js";
import {
  AGENT_RUN_EVENT_TYPE,
  CONVERSATION_EVENT_TYPE,
} from "../../src/shared/fact-ledger/contracts.js";
import { reduceRunFacts, buildTriggerSeqIndex } from "../../src/context-compiler/run-facts.js";

function inbound(eventId: string, streamSeq: number): ConversationEvent {
  return {
    eventId,
    accountId: "account-1",
    streamId: "stream-1",
    streamSeq,
    eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
    schemaVersion: 1,
    occurredAt: "2026-08-29T00:00:00.000Z",
    receivedAt: "2026-08-29T00:00:01.000Z",
    recordedAt: "2026-08-29T00:00:02.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { channel: "weixin", text: "hello", attachmentRefs: [] },
  };
}

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
    occurredAt: "2026-08-29T00:00:05.000Z",
    recordedAt: "2026-08-29T00:00:06.000Z",
    causationId: "trigger-1",
    correlationId: "trigger-1",
    payload: payload as AgentRunEvent["payload"],
    ...extras,
  } as AgentRunEvent;
}

function completedRun(runId: string, startSeq: number, responseArtifactId: string): AgentRunEvent[] {
  return [
    runEvent(runId, startSeq, AGENT_RUN_EVENT_TYPE.RUN_STARTED, {
      runKind: "chat",
      triggerEventId: "trigger-1",
    }),
    runEvent(runId, startSeq + 1, AGENT_RUN_EVENT_TYPE.TOOL_CALL_COMPLETED, {
      toolCallId: "call-t1",
      resultArtifactId: "tool-result-artifact",
    }),
    runEvent(runId, startSeq + 2, AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED, {
      callId: `call-${runId}:2`,
      round: 2,
      manifestId: "manifest-1",
      responseArtifactId,
    }),
    runEvent(runId, startSeq + 3, AGENT_RUN_EVENT_TYPE.RUN_COMPLETED, { rounds: 2 }),
  ];
}

test("a completed run contributes ordered assistant and tool entries", () => {
  const runEvents = completedRun("run-1", 1, "response-artifact");
  const reduction = reduceRunFacts({
    runEvents,
    triggerStreamSeqByEventId: buildTriggerSeqIndex([inbound("trigger-1", 4)]),
    artifactTextById: new Map([
      ["response-artifact", "final reply"],
      ["tool-result-artifact", "tool output"],
    ]),
  });
  assert.deepEqual(
    reduction.entries.map((entry) => [entry.role, entry.text, entry.runSeq]),
    [
      ["tool", "tool output", 2],
      ["assistant", "final reply", 3],
    ],
  );
  assert.equal(reduction.entries[1]?.callId, `call-run-1:2`);
  assert.equal(reduction.entries[0]?.streamSeq, 4);
  assert.deepEqual(reduction.diagnostics, []);
  // Run-derived entries never carry attachments in Phase 4.
  assert.deepEqual(reduction.entries[0]?.attachments, []);
});

test("interrupted and zombie runs are excluded entirely", () => {
  const interrupted: AgentRunEvent[] = [
    runEvent("run-i", 1, AGENT_RUN_EVENT_TYPE.RUN_STARTED, {
      runKind: "chat",
      triggerEventId: "trigger-1",
    }),
    runEvent("run-i", 2, AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED, {
      callId: "call-i",
      round: 1,
      manifestId: "m",
      responseArtifactId: "response-artifact",
    }),
    runEvent("run-i", 3, AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED, { reason: "turn_rolled_back" }),
  ];
  const zombie: AgentRunEvent[] = [
    runEvent("run-z", 1, AGENT_RUN_EVENT_TYPE.RUN_STARTED, {
      runKind: "chat",
      triggerEventId: "trigger-1",
    }),
    runEvent("run-z", 2, AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED, {
      callId: "call-z",
      round: 1,
      manifestId: "m",
      responseArtifactId: "response-artifact",
    }),
  ];
  const reduction = reduceRunFacts({
    runEvents: [...interrupted, ...zombie],
    triggerStreamSeqByEventId: buildTriggerSeqIndex([inbound("trigger-1", 1)]),
    artifactTextById: new Map([["response-artifact", "ghost"]]),
  });
  assert.deepEqual(reduction.entries, []);
  assert.deepEqual(reduction.diagnostics, []);
});

test("runs triggered outside the compile window never produce entries", () => {
  const reduction = reduceRunFacts({
    runEvents: completedRun("run-1", 1, "response-artifact"),
    // trigger-1 is pre-boundary and therefore not part of the window index.
    triggerStreamSeqByEventId: buildTriggerSeqIndex([inbound("later", 9)], 5),
    artifactTextById: new Map([["response-artifact", "reply"]]),
  });
  assert.deepEqual(reduction.entries, []);
});

test("missing artifacts degrade to empty text with fixed diagnostics", () => {
  const reduction = reduceRunFacts({
    runEvents: completedRun("run-1", 1, "response-artifact"),
    triggerStreamSeqByEventId: buildTriggerSeqIndex([inbound("trigger-1", 2)]),
    artifactTextById: new Map(),
  });
  assert.deepEqual(
    reduction.entries.map((entry) => [entry.role, entry.text]),
    [
      ["tool", ""],
      ["assistant", ""],
    ],
  );
  assert.deepEqual(
    reduction.diagnostics.map((diagnostic) => diagnostic.code).sort(),
    ["run_response_artifact_missing", "run_result_artifact_missing"],
  );
});

test("tool_call_failed uses the error artifact when present", () => {
  const runEvents = [
    runEvent("run-1", 1, AGENT_RUN_EVENT_TYPE.RUN_STARTED, {
      runKind: "chat",
      triggerEventId: "trigger-1",
    }),
    runEvent("run-1", 2, AGENT_RUN_EVENT_TYPE.TOOL_CALL_FAILED, {
      toolCallId: "call-t1",
      error: "tool_not_found",
      errorArtifactId: "error-artifact",
    }),
    runEvent("run-1", 3, AGENT_RUN_EVENT_TYPE.RUN_COMPLETED, { rounds: 1 }),
  ];
  const reduction = reduceRunFacts({
    runEvents,
    triggerStreamSeqByEventId: buildTriggerSeqIndex([inbound("trigger-1", 1)]),
    artifactTextById: new Map([["error-artifact", "boom"]]),
  });
  assert.deepEqual(
    reduction.entries.map((entry) => [entry.role, entry.text]),
    [["tool", "boom"]],
  );
});
