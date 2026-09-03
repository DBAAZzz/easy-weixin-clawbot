import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_TIMEZONE,
  buildContextManifestDocument,
  createDeliveryId,
  createManifestId,
  createOutboundFactEventId,
  createRunEventId,
  createRunId,
  createContextCompilerV1,
  sha256CanonicalJson,
  type CompileContextInputV1,
  type ConversationEvent,
} from "@clawbot/agent";
import { PrismaClient } from "@prisma/client";
import { PrismaAgentRunStore } from "../../src/db/agent-run-store.impl.js";
import { PrismaArtifactRevisionStore } from "../../src/db/artifact-revision-store.impl.js";
import { RunLedgerRolloutStore } from "../../src/db/run-ledger-rollout-store.js";
import { PrismaConversationEventStore } from "../../src/db/conversation-event-store.impl.js";
import { reconcileWeixinIngress } from "../../src/db/fact-ledger-reconciliation.js";
import { WeixinIngressDispatchStore } from "../../src/db/weixin-ingress-dispatch-store.js";
import { createWeixinIngressLifecycle } from "../../src/weixin/ingress-controller.js";
import type { ServerWeixinAgent } from "../../src/agent.js";

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
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `run-ledger-${nonce}`;
const streamId = `user-${nonce}`;

after(async () => prisma.$disconnect());

async function appendInbound(eventId: string, text: string): Promise<ConversationEvent> {
  const appended = await eventStore.append({
    eventId,
    accountId,
    streamId,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-29T00:00:00.000Z",
    receivedAt: "2026-08-29T00:00:01.000Z",
    actor: { kind: "user", id: streamId },
    payload: { channel: "weixin", text, attachmentRefs: [] },
  });
  return appended.value;
}

async function appendRunEvent(
  runId: string,
  eventId: string,
  eventType: string,
  payload: unknown,
  sourceEventId?: string,
): Promise<void> {
  await runStore.append({
    eventId,
    runId,
    accountId,
    conversationStreamId: streamId,
    eventType: eventType as "run_started",
    schemaVersion: 1,
    occurredAt: "2026-08-29T00:00:02.000Z",
    // Production semantics: run_started is caused by the source receipt; all
    // events correlate back to it (design §5.2).
    causationId: eventType === "run_started" ? (sourceEventId ?? runId) : runId,
    correlationId: sourceEventId ?? runId,
    payload: payload as never,
  });
}

const RESPONSE_ARTIFACT_HASH = "b".repeat(64);
const DELIVERY_HASH = "c".repeat(64);

test("run ledger chain is ordered, causally closed and manifest-backed", async (t) => {
  await prisma.account.create({ data: { id: accountId } });
  const source = await appendInbound(`src-${nonce}`, "hello");

  const runId = createRunId(accountId, source.eventId);
  const manifestId = createManifestId(accountId, runId);
  const requestDoc = {
    schemaVersion: 1,
    runId,
    round: 1,
    modelRevisionId: `model-config-revision-v1:${"d".repeat(64)}`,
    system: "system",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    tools: [],
    trim: {
      trimLevel: 0,
      originalTokens: 10,
      trimmedTokens: 10,
      droppedMessages: 0,
      fixedOverheadTokens: 2,
    },
  };
  // Content-addressed: the id derives from the document so re-runs never
  // conflict with unrelated nonce-varying content.
  const requestArtifactId = `canonical-request-v1:${sha256CanonicalJson(requestDoc)}`;
  const responseArtifactId = `model-response-v1:${RESPONSE_ARTIFACT_HASH}`;
  const deliveryId = createDeliveryId(accountId, source.eventId);

  const requestArtifact = await artifactStore.put({
    artifactId: requestArtifactId,
    kind: "canonical_request",
    sha256: sha256CanonicalJson(requestDoc),
    schemaVersion: 1,
    inlineJson: requestDoc,
  });
  assert.equal(requestArtifact.appended, true);
  assert.equal(requestArtifact.value.sha256, sha256CanonicalJson(requestDoc));
  const manifestDoc = buildContextManifestDocument({
    accountId,
    runId,
    manifestId,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
    conversationEventIds: [source.eventId],
    runEventIds: [],
    modelRevisionId: requestDoc.modelRevisionId,
    promptRevisionId: `prompt-revision-v1:${"e".repeat(64)}`,
    skillRevisionIds: [],
    toolRevisionIds: [],
    effectiveTime: "2026-08-29T08:00:00.000+08:00",
    timezone: CONTEXT_TIMEZONE,
    trimDecision: requestDoc.trim,
    canonicalRequestHash: requestArtifact.value.sha256,
  });
  await artifactStore.put({
    artifactId: manifestId,
    kind: "context_manifest",
    sha256: sha256CanonicalJson(manifestDoc),
    schemaVersion: 1,
    inlineJson: manifestDoc,
  });

  const callId = `call-v1:${runId.slice(-8)}`;
  const chain: Array<[string, string, unknown]> = [
    [
      "run_started",
      createRunEventId(accountId, runId, "run_started", "1"),
      { runKind: "chat", triggerEventId: source.eventId },
    ],
    [
      "model_call_started",
      createRunEventId(accountId, runId, "model_call_started", callId),
      { callId, round: 1, manifestId, requestArtifactId },
    ],
    [
      "model_call_completed",
      createRunEventId(accountId, runId, "model_call_completed", callId),
      { callId, responseArtifactId, stopReason: "stop" },
    ],
    ["run_completed", createRunEventId(accountId, runId, "run_completed", "1"), { rounds: 1 }],
    [
      "delivery_requested",
      createRunEventId(accountId, runId, "delivery_requested", deliveryId),
      { deliveryId, responseArtifactId },
    ],
  ];
  for (const [eventType, eventId, payload] of chain) {
    await appendRunEvent(runId, eventId, eventType, payload, source.eventId);
  }

  await t.test("run events exist with deterministic ids in logical order", async () => {
    const events = await runStore.listRun({ runId, limit: 100 });
    assert.deepEqual(
      events.map((event) => event.eventType),
      [
        "run_started",
        "model_call_started",
        "model_call_completed",
        "run_completed",
        "delivery_requested",
      ],
    );
    const started = events[0]!;
    assert.deepEqual(started.payload, { runKind: "chat", triggerEventId: source.eventId });
    assert.equal(started.correlationId, source.eventId);
    const runSeqs = events.map((event) => event.runSeq);
    assert.deepEqual([...runSeqs].sort((a, b) => a - b), runSeqs);
  });

  await t.test("policy v2 compile consumes the run facts deterministically", async () => {
    const compiler = createContextCompilerV1({
      conversationEventStore: eventStore,
      agentRunStore: runStore,
      artifactRevisionStore: artifactStore,
    });
    const compileInput: CompileContextInputV1 = {
      accountId,
      conversationStreamId: streamId,
      eventCursor: source.streamSeq,
      compilerVersion: CONTEXT_COMPILER_VERSION,
      contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
      effectiveTime: "2026-08-29T08:00:00.000+08:00",
      timezone: CONTEXT_TIMEZONE,
    };
    const compiled = await compiler.compile(compileInput);
    assert.deepEqual(
      compiled.context.entries.map((entry) => [entry.role, entry.text]),
      [
        ["user", "hello"],
        // The model_response artifact was never stored in this fixture, so the
        // run entry degrades to empty text with a fixed diagnostic (design §10.2).
        ["assistant", ""],
      ],
    );
    assert.deepEqual(
      compiled.diagnostics.map((diagnostic) => diagnostic.code),
      ["run_response_artifact_missing"],
    );
    assert.deepEqual(compiled.conversationEventIds, [source.eventId]);

    // Redelivery: same receipt derives the same deterministic run id.
    assert.equal(createRunId(accountId, source.eventId), runId);
  });

  await t.test("artifact revisions dedupe identical content", async () => {
    const replay = await artifactStore.put({
      artifactId: requestArtifactId,
      kind: "canonical_request",
      sha256: sha256CanonicalJson(requestDoc),
      schemaVersion: 1,
      inlineJson: requestDoc,
    });
    assert.equal(replay.appended, false);
  });

  await t.test("manifest hash is verifiable from the stored artifact document", async () => {
    const manifestArtifact = await artifactStore.getById(manifestId);
    assert.ok(manifestArtifact?.inlineJson);
    const manifestJson = manifestArtifact.inlineJson as { canonicalRequestHash: string };
    const requestArtifactRow = await artifactStore.getById(requestArtifactId);
    assert.ok(requestArtifactRow?.inlineJson);
    assert.equal(sha256CanonicalJson(requestArtifactRow.inlineJson), requestArtifactRow.sha256);
    assert.equal(manifestJson.canonicalRequestHash, requestArtifactRow.sha256);
  });

  await t.test("append-only triggers reject UPDATE and DELETE", async () => {
    await assert.rejects(() =>
      prisma.$executeRawUnsafe(
        `UPDATE "agent_run_events" SET "event_type" = 'run_completed' WHERE "run_id" = '${runId}'`,
      ),
    );
    await assert.rejects(() =>
      prisma.$executeRawUnsafe(`DELETE FROM "artifact_revisions" WHERE "artifact_id" = '${manifestId}'`),
    );
  });

  await t.test("zombie runs are observed but not raised as issues", async () => {
    const zombieRunId = createRunId(accountId, `zombie-${nonce}`);
    await appendRunEvent(
      zombieRunId,
      createRunEventId(accountId, zombieRunId, "run_started", "1"),
      "run_started",
      { runKind: "chat", triggerEventId: source.eventId },
    );
    const report = await reconcileWeixinIngress(accountId, { zombieRunSeconds: 0 }, prisma);
    assert.equal(report.summary.zombie_run >= 1, true);
    // Zombie runs are observations only — never actionable issues.
    assert.equal(
      report.issues.every((issue) => issue.result !== ("zombie_run" as "missing")),
      true,
    );
  });
});

test("settle records delivery facts only for runs that requested delivery", async (t) => {
  const agent: ServerWeixinAgent = {
    chat: async () => ({ text: "ok" }),
    chatFromIngress: async () => ({ text: "ok" }),
    clearFromIngress: async () => {},
  };
  const dispatchStore = new WeixinIngressDispatchStore(prisma);
  const lifecycle = createWeixinIngressLifecycle({
    accountId,
    rolloutEnabled: true,
    runLedgerEnabled: true,
    agent,
    eventStore,
    dispatchStore,
    agentRunStore: runStore,
  });

  const source = await appendInbound(`src-delivery-${nonce}`, "again");
  await prisma.weixinIngressDispatch.create({
    data: {
      eventId: source.eventId,
      accountId,
      status: "processing",
      attemptCount: 1,
      claimedAt: new Date(),
    },
  });
  const runId = createRunId(accountId, source.eventId);
  const deliveryId = createDeliveryId(accountId, source.eventId);
  await appendRunEvent(
    runId,
    createRunEventId(accountId, runId, "run_started", "1"),
    "run_started",
    { runKind: "chat", triggerEventId: source.eventId },
    source.eventId,
  );
  await appendRunEvent(
    runId,
    createRunEventId(accountId, runId, "delivery_requested", deliveryId),
    "delivery_requested",
    { deliveryId, responseArtifactId: `model-response-v1:${RESPONSE_ARTIFACT_HASH}` },
  );

  await lifecycle.settle({
    receiptId: source.eventId,
    outcome: "chat",
    deliveryReport: { ok: true, channelMessageId: "client-1", textSent: "好的" },
  });

  await t.test("delivery_succeeded and outbound fact are recorded", async () => {
    const deliveryEvent = await runStore.getById(
      createRunEventId(accountId, runId, "delivery_succeeded", deliveryId),
    );
    assert.ok(deliveryEvent);
    assert.deepEqual(deliveryEvent.payload, { deliveryId, channelMessageId: "client-1" });
    const outbound = await eventStore.getById(
      createOutboundFactEventId(accountId, source.eventId, "delivered"),
    );
    assert.ok(outbound);
    assert.equal(outbound.eventType, "outbound_message_delivered");
    assert.deepEqual(outbound.payload, {
      deliveryId,
      channel: "weixin",
      channelMessageId: "client-1",
      text: "好的",
      attachmentRefs: [],
    });
  });

  await t.test("reconciliation accepts the delivered fact once its run is terminal", async () => {
    const report = await reconcileWeixinIngress(
      accountId,
      { zombieRunSeconds: 0 },
      prisma,
    );
    const unexpectedOnOutbound = report.issues.filter((issue) =>
      issue.eventId.startsWith("outbound-v1:"),
    );
    // The delivery run has no terminal event yet → unexpected until it finishes.
    assert.equal(unexpectedOnOutbound.length, 1);
    await appendRunEvent(
      runId,
      createRunEventId(accountId, runId, "run_completed", "settle-1"),
      "run_completed",
      { rounds: 1 },
    );
    const settled = await reconcileWeixinIngress(accountId, { zombieRunSeconds: 0 }, prisma);
    assert.equal(
      settled.issues.some((issue) => issue.eventId.startsWith("outbound-v1:")),
      false,
    );
  });

  await t.test("degraded run without delivery_requested still records the outbound fact", async () => {
    const degradedSource = await appendInbound(`src-degraded-${nonce}`, "degraded");
    await prisma.weixinIngressDispatch.create({
      data: {
        eventId: degradedSource.eventId,
        accountId,
        status: "processing",
        attemptCount: 1,
        claimedAt: new Date(),
      },
    });
    await lifecycle.settle({
      receiptId: degradedSource.eventId,
      outcome: "chat",
      deliveryReport: { ok: true, channelMessageId: "client-2", textSent: "回复" },
    });
    const degradedRunId = createRunId(accountId, degradedSource.eventId);
    const deliveryRunEvent = await runStore.getById(
      createRunEventId(
        accountId,
        degradedRunId,
        "delivery_succeeded",
        createDeliveryId(accountId, degradedSource.eventId),
      ),
    );
    assert.equal(deliveryRunEvent, null);
    const outbound = await eventStore.getById(
      createOutboundFactEventId(accountId, degradedSource.eventId, "delivered"),
    );
    assert.ok(outbound);
  });

  await t.test("rollout row missing means disabled", async () => {
    assert.equal(await new RunLedgerRolloutStore(prisma).isEnabled(accountId), false);
  });
});
