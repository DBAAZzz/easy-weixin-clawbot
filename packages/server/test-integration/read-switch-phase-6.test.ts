/**
 * Phase 6 integration (design §15.4): trigger run full chain on a disposable
 * PostgreSQL — deterministic runId, anchored run_started, v3 trigger entry
 * derivation, proactive outbound facts, reconciliation, and read_path state.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_POLICY_REVISION_ID_V3,
  CONTEXT_TIMEZONE,
  createDeliveryId,
  createRunLedgerRecorder,
  createTriggerRunId,
  extractRound1TriggerPrompt,
  recordProactiveOutbound,
  sha256CanonicalJson,
  type CompileContextInputV1,
} from "@clawbot/agent";
import { PrismaClient } from "@prisma/client";
import { PrismaAgentRunStore } from "../src/db/agent-run-store.impl.js";
import { PrismaArtifactRevisionStore } from "../src/db/artifact-revision-store.impl.js";
import { PrismaConversationEventStore } from "../src/db/conversation-event-store.impl.js";
import { createLocalArtifactContentSink } from "../src/db/artifact-content-sink.js";
import { reconcileWeixinIngress } from "../src/db/fact-ledger-reconciliation.js";
import { RunLedgerRolloutStore } from "../src/db/run-ledger-rollout-store.js";
import { FACT_LEDGER_ARTIFACTS_DIR } from "../src/paths.js";

const databaseUrl = process.env.FACT_LEDGER_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("FACT_LEDGER_TEST_DATABASE_URL is required");
const databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1);
if (!databaseName?.endsWith("_fact_ledger_test")) {
  throw new Error("Fact ledger integration tests require a database ending in _fact_ledger_test");
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
const eventStore = new PrismaConversationEventStore(prisma);
const runStore = new PrismaAgentRunStore(prisma);
const artifactStore = new PrismaArtifactRevisionStore(prisma);
const contentSink = createLocalArtifactContentSink(FACT_LEDGER_ARTIFACTS_DIR);
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `read-switch-${nonce}`;
const streamId = `conv-${nonce}`;

after(async () =>
  prisma.account
    .delete({ where: { id: accountId } })
    .catch(() => undefined)
    .then(() => prisma.$disconnect()),
);

async function ensureAccount(): Promise<void> {
  await prisma.account.upsert({
    where: { id: accountId },
    create: { id: accountId },
    update: {},
  });
}

function compileInput(
  overrides: Partial<CompileContextInputV1> = {},
): CompileContextInputV1 {
  return {
    accountId,
    conversationStreamId: streamId,
    eventCursor: 10,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V3,
    effectiveTime: "2026-08-30T10:00:00.000Z",
    timezone: CONTEXT_TIMEZONE,
    ...overrides,
  };
}

async function appendInbound(text: string): Promise<number> {
  const appended = await eventStore.append({
    eventId: `inbound-${nonce}-${Math.random().toString(16).slice(2)}`,
    accountId,
    streamId,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-30T09:59:00.000Z",
    receivedAt: "2026-08-30T09:59:01.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { channel: "weixin", text, attachmentRefs: [] },
  });
  return appended.value.streamSeq;
}

async function putInlineArtifact(artifactId: string, document: unknown): Promise<string> {
  const put = await artifactStore.put({
    artifactId,
    kind: "canonical_request",
    schemaVersion: 1,
    sha256: sha256CanonicalJson(document),
    inlineJson: document as never,
  });
  return put.value.artifactId;
}

test("trigger run full chain: anchored start → v3 trigger entry → proactive facts → clean reconciliation", async () => {
  await ensureAccount();
  // 会话水位 > 0：两条历史入站消息。
  await appendInbound("早上好");
  await appendInbound("在忙什么");
  const headSeq = await eventStore.getStreamHeadSeq(accountId, streamId);
  assert.ok(headSeq !== undefined && headSeq >= 2);

  // round-1 CANONICAL_REQUEST 制品：trigger prompt 的最终组装形态。
  const requestDoc = {
    round: 1,
    system: "system",
    messages: [
      {
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text: "早上好" }],
      },
      {
        role: "trigger",
        timestamp: 2,
        meta: { kind: "pulse" },
        content: [
          { type: "text", text: "[当前时间: 2026-08-30 18:00]\n<memory>用户喜欢简短回复</memory>\n" },
          { type: "text", text: "和用户聊聊今天的安排" },
        ],
      },
    ],
    tools: [],
    trim: { trimLevel: 0, originalTokens: 1, trimmedTokens: 1, droppedMessages: 0, fixedOverheadTokens: 0 },
  };
  const responseDoc = {
    content: [{ type: "text", text: "今天下午三点有个会议，别忘了。" }],
  };
  const requestArtifactId = await putInlineArtifact(`req-${nonce}`, requestDoc);

  // 真实 recorder 全链路（与生产 turn 同一组件；MODEL_RESPONSE 制品由 recorder 落）。
  const runId = createTriggerRunId(accountId, "heartbeat", "42", "2026-08-30T10:00:00.000Z");
  const recorder = createRunLedgerRecorder({
    agentRunStore: runStore,
    artifactRevisionStore: artifactStore,
    contentSink,
    accountId,
    runId,
  });
  assert.equal(
    await recorder.start({
      conversationStreamId: streamId,
      anchorStreamSeq: headSeq,
      occurredAt: "2026-08-30T10:00:00.000Z",
    }),
    true,
  );
  const manifestArtifact = await recorder.putArtifact("context_manifest", { manifestId: `m-${nonce}` });
  assert.ok(manifestArtifact);
  assert.equal(await recorder.recordContextCompiled(manifestArtifact.artifactId), true);
  recorder.recordModelCallStarted({
    round: 1,
    manifestId: manifestArtifact.artifactId,
    requestArtifactId,
  });
  recorder.recordModelCallCompleted({
    round: 1,
    stopReason: "stop",
    responseDoc,
  });
  assert.equal(
    await recorder.finishCompleted({
      rounds: 1,
      finalResponseArtifactId: recorder.getFinalResponseArtifactId(),
    }),
    true,
  );
  assert.equal(await recorder.recordDeliveryRequested({ deliveryId: createDeliveryId(accountId, runId) }), true);
  await recorder.drain();

  // push 成功 → delivery_succeeded + outbound fact（causation = runId）。
  await recordProactiveOutbound(
    {
      accountId,
      executionStreamId: streamId,
      targetConversationId: streamId,
      runId,
      text: "今天下午三点有个会议，别忘了。",
      pushSucceeded: true,
    },
    { agentRunStore: runStore, conversationEventStore: eventStore },
  );

  // run_started 落锚 + 终态/投递事件齐备。
  const runEvents = await runStore.listRun({ runId, limit: 100 });
  const startedEvent = runEvents.find((event) => event.eventType === "run_started");
  assert.ok(startedEvent);
  assert.deepEqual((startedEvent.payload as { anchorStreamSeq?: number }).anchorStreamSeq, headSeq);
  assert.equal(
    (startedEvent.payload as { triggerEventId?: string }).triggerEventId,
    undefined,
  );
  assert.ok(runEvents.some((event) => event.eventType === "delivery_succeeded"));
  assert.ok(runEvents.some((event) => event.eventType === "run_completed"));

  // outbound fact：落目标会话 stream，causation/correlation = runId。
  const delivered = await prisma.conversationEvent.findFirst({
    where: { accountId, eventType: "outbound_message_delivered" },
  });
  assert.ok(delivered);
  assert.equal(delivered.streamId, streamId);
  assert.equal(delivered.causationId, runId);
  assert.equal(delivered.correlationId, runId);

  // v3 编译：trigger entry 派生自 round-1 request，位于 assistant 之前。
  const cursor = await eventStore.getStreamHeadSeq(accountId, streamId);
  const { createContextCompilerV1 } = await import("@clawbot/agent");
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore,
    agentRunStore: runStore,
    artifactRevisionStore: artifactStore,
    contentSink,
  });
  const compiled = await compiler.compile(compileInput({ eventCursor: cursor }));
  const triggerEntries = compiled.context.entries.filter((entry) => entry.role === "trigger");
  assert.equal(triggerEntries.length, 1);
  const triggerEntry = triggerEntries[0]!;
  const expectedPrompt = extractRound1TriggerPrompt(requestDoc);
  assert.equal(triggerEntry.text, expectedPrompt);
  assert.ok(triggerEntry.text.includes("<memory>用户喜欢简短回复</memory>"));
  assert.equal(triggerEntry.streamSeq, headSeq, "trigger entry sits at the anchored stream position");
  const assistantIndex = compiled.context.entries.findIndex((entry) => entry.role === "assistant");
  const triggerIndex = compiled.context.entries.indexOf(triggerEntry);
  assert.ok(triggerIndex < assistantIndex, "trigger prompt precedes the reply");
  const assistantEntry = compiled.context.entries[assistantIndex]!;
  assert.equal(
    assistantEntry.text,
    "今天下午三点有个会议，别忘了。",
    "assistant entry text comes from the MODEL_RESPONSE artifact",
  );
  assert.deepEqual(
    compiled.diagnostics.filter((diagnostic) => diagnostic.code === "run_anchor_missing"),
    [],
  );

  // v3 相对 v2 的唯一增量 = trigger run 派生的全部 entries（trigger prompt +
  // 本 run 的回复；本流没有 ingress run）；hash 含 policy id 天然不同，比 entries。
  const compiledV2 = await compiler.compile(
    compileInput({ eventCursor: cursor, contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2 }),
  );
  const v3WithoutTriggerRun = compiled.context.entries.filter((entry) => entry.runId !== runId);
  assert.deepEqual(v3WithoutTriggerRun, compiledV2.context.entries);

  // 对账：proactive outbound + terminal run → 无 unexpected / zombie。
  const report = await reconcileWeixinIngress(accountId);
  assert.equal(report.summary.unexpected, 0);
  assert.equal(report.summary.zombie_run, 0);

  // read_path：默认 legacy；置 canonical 后读回 canonical。
  const rolloutStore = new RunLedgerRolloutStore(prisma);
  assert.equal(await rolloutStore.readPath(accountId), "legacy");
  await prisma.runLedgerRollout.create({
    data: { accountId, enabled: true, readPath: "canonical" },
  });
  assert.equal(await rolloutStore.readPath(accountId), "canonical");
});

test("run_started without an anchor compiles via the local-clock approximation (dual-only shape)", async () => {
  await ensureAccount();
  const localStream = `${streamId}-noanchor`;
  await eventStore.append({
    eventId: `noanchor-inbound-${nonce}`,
    accountId,
    streamId: localStream,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-30T09:00:00.000Z",
    receivedAt: "2026-08-30T09:00:01.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { channel: "weixin", text: "history before pulse", attachmentRefs: [] },
  });
  const requestArtifactId = await putInlineArtifact(`req-noanchor-${nonce}`, {
    round: 1,
    system: "system",
    messages: [
      { role: "trigger", timestamp: 1, meta: { kind: "pulse" }, content: [{ type: "text", text: "no-anchor prompt" }] },
    ],
    tools: [],
    trim: { trimLevel: 0, originalTokens: 1, trimmedTokens: 1, droppedMessages: 0, fixedOverheadTokens: 0 },
  });
  const noAnchorRunId = createTriggerRunId(accountId, "scheduler", "7", "2026-08-30T09:30:00.000Z");
  const recorder = createRunLedgerRecorder({
    agentRunStore: runStore,
    artifactRevisionStore: artifactStore,
    contentSink,
    accountId,
    runId: noAnchorRunId,
  });
  assert.equal(
    await recorder.start({
      conversationStreamId: localStream,
      occurredAt: "2026-08-30T09:30:00.000Z",
    }),
    true,
  );
  recorder.recordModelCallStarted({ round: 1, manifestId: "m", requestArtifactId });
  recorder.recordModelCallCompleted({
    round: 1,
    stopReason: "stop",
    responseDoc: { content: [{ type: "text", text: "ok" }] },
  });
  assert.equal(await recorder.finishCompleted({ rounds: 1 }), true);
  await recorder.drain();

  const { createContextCompilerV1 } = await import("@clawbot/agent");
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore,
    agentRunStore: runStore,
    artifactRevisionStore: artifactStore,
    contentSink,
  });
  const compiled = await compiler.compile(
    compileInput({
      conversationStreamId: localStream,
      eventCursor: 1,
    }),
  );
  const triggerEntry = compiled.context.entries.find((entry) => entry.role === "trigger");
  assert.ok(triggerEntry, "trigger entry still derives under the clock approximation");
  assert.equal(
    compiled.diagnostics.some((diagnostic) => diagnostic.code === "run_anchor_missing"),
    true,
    "the missing anchor is surfaced as a diagnostic — dual-only, blocks canonical (§6.5)",
  );

  // 该窗口触发 canonical 排序锚门禁失败。
  const missingAnchorRuns = await prisma.agentRunEvent.findMany({
    where: {
      accountId,
      eventType: "run_started",
      conversationStreamId: localStream,
    },
  });
  const triggerStarts = missingAnchorRuns.filter(
    (event) => (event.payload as { triggerEventId?: string }).triggerEventId === undefined,
  );
  assert.equal(triggerStarts.length, 1);
  assert.notEqual(
    typeof (triggerStarts[0]!.payload as { anchorStreamSeq?: number }).anchorStreamSeq,
    "number",
    "anchorStreamSeq must be absent for the approximation shape",
  );
});
