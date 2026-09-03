import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_TIMEZONE,
  createContextCompilerV1,
  createRunId,
  readMemoryCoverage,
  sha256CanonicalJson,
  writeMemoryFactToLedger,
  type CompileContextInputV1,
  type ConversationEvent,
  type MemoryAssertionCategory,
} from "@clawbot/agent";
import { PrismaClient } from "@prisma/client";
import { PrismaAgentRunStore } from "../../src/db/agent-run-store.impl.js";
import { PrismaArtifactRevisionStore } from "../../src/db/artifact-revision-store.impl.js";
import { createPrismaAttachmentArtifactResolver } from "../../src/db/prisma-attachment-artifact-resolver.js";
import { PrismaConversationEventStore } from "../../src/db/conversation-event-store.impl.js";
import { PrismaMemoryEventStore } from "../../src/db/memory-event-store.impl.js";
import { PrismaTapeStore } from "../../src/db/tape-store.impl.js";
import { setTapeStore } from "@clawbot/agent/ports";
import { RunLedgerRolloutStore } from "../../src/db/run-ledger-rollout-store.js";

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
const memoryStore = new PrismaMemoryEventStore(prisma);
const tapeStore = new PrismaTapeStore();
setTapeStore(tapeStore);
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `coverage-${nonce}`;
const streamId = `user-${nonce}`;
const sessionBranch = `session-${nonce}`;

after(async () => prisma.$disconnect());

async function appendInbound(
  eventId: string,
  text: string,
  attachmentRefs: string[] = [],
): Promise<ConversationEvent> {
  const appended = await eventStore.append({
    eventId,
    accountId,
    streamId,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-30T00:00:00.000Z",
    receivedAt: "2026-08-30T00:00:01.000Z",
    actor: { kind: "user", id: streamId },
    payload: { channel: "weixin", text, attachmentRefs },
  });
  return appended.value;
}

const GLOBAL_BRANCH = "__global__";
const EVIDENCE = {
  sourceEventId: `src-${nonce}`,
  runId: createRunId(accountId, `src-${nonce}`),
  extractionModelRevisionId: `model-config-revision-v1:${"d".repeat(64)}`,
  extractionPromptRevisionId: `prompt-revision-v1:${"e".repeat(64)}`,
};

test("memory coverage is captured into the manifest at compile time", async () => {
  // 用真实 store 读取水位并固化 MEMORY_SNAPSHOT（设计 §6）
  const stored: Array<{ artifactId: string; document: unknown }> = [];
  const coverage = await readMemoryCoverage({
    accountId,
    runId: createRunId(accountId, `snap-${nonce}`),
    sessionBranch,
    memoryEventStore: memoryStore,
    putArtifact: async (
      kind: Parameters<Parameters<typeof readMemoryCoverage>[0]["putArtifact"]>[0],
      document: unknown,
      options?: { artifactId?: string },
    ) => {
      assert.equal(kind, "memory_snapshot");
      const put = await artifactStore.put({
        artifactId: options?.artifactId!,
        kind: "memory_snapshot",
        sha256: sha256CanonicalJson(document),
        schemaVersion: 1,
        inlineJson: document as import("@clawbot/agent").JsonValue,
      });
      stored.push({ artifactId: put.value.artifactId, document });
      return { artifactId: put.value.artifactId, sha256: put.value.sha256 };
    },
  });

  // 此前已写入一条 global 断言：水位与 headSeq 一致
  const globalHead = await memoryStore.headSeq(accountId, "__global__");
  assert.equal(coverage.watermark, `wm-v1:${globalHead}/0`);
  assert.ok(coverage.memoryArtifactId);
  assert.equal(coverage.memoryArtifactId, stored[0]?.artifactId);
  const document = stored[0]?.document as { watermark: string; branches: Record<string, unknown> };
  assert.equal(document.watermark, coverage.watermark);
  assert.ok(document.branches);
});

test("memory facts are recorded with evidence and stay idempotent", async (t) => {
  await prisma.account.create({ data: { id: accountId } });
  const source = await appendInbound(EVIDENCE.sourceEventId, "我对香菜过敏");

  const input = {
    accountId,
    branch: GLOBAL_BRANCH,
    scope: "global" as const,
    category: "preference" as MemoryAssertionCategory,
    key: "口味",
    value: "不吃香菜",
    confidence: 0.95,
    evidence: EVIDENCE,
  };

  await t.test("first assertion is appended with full evidence", async () => {
    const outcome = await writeMemoryFactToLedger({ memoryEventStore: memoryStore }, input);
    assert.equal(outcome.result, "appended");
    // 生产队列在账本写入后写 Tape——显式模拟，保证后续 previous 可见
    await tapeStore.createEntry({
      accountId,
      branch: GLOBAL_BRANCH,
      type: "record",
      category: "preference",
      payload: {
        fragments: [{ kind: "text", data: { key: "口味", value: "不吃香菜" } }],
      },
      actor: "agent:test",
      source: null,
    });
    const event = await memoryStore.getById(
      outcome.result === "appended" ? outcome.assertedEventId : "",
    );
    assert.ok(event);
    const payload = event.payload as Record<string, unknown>;
    assert.deepEqual(payload.sourceConversationEventIds, [source.eventId]);
    assert.equal(payload.sourceRunId, EVIDENCE.runId);
    assert.equal(payload.extractionModelRevisionId, EVIDENCE.extractionModelRevisionId);
    assert.equal(payload.confidence, 0.95);
  });

  await t.test("replaying the same write is idempotent (no second event)", async () => {
    const before = await memoryStore.headSeq(accountId, GLOBAL_BRANCH);
    await writeMemoryFactToLedger({ memoryEventStore: memoryStore }, input);
    const after = await memoryStore.headSeq(accountId, GLOBAL_BRANCH);
    assert.equal(after, before);
  });

  await t.test("a value change produces a resolvable superseded chain", async () => {
    const changed = { ...input, value: "不吃香菜也不吃辣" };
    const outcome = await writeMemoryFactToLedger({ memoryEventStore: memoryStore }, changed);
    assert.equal(outcome.result, "appended");

    const live = await memoryStore.findLiveAssertionByKey(
      accountId,
      GLOBAL_BRANCH,
      "preference",
      "口味",
    );
    assert.ok(live);
    assert.equal((live.payload as { value: unknown }).value, "不吃香菜也不吃辣");

    // superseded 事件存在，且指向旧断言与新断言
    const supersededRows = await prisma.memoryEvent.findMany({
      where: { accountId, eventType: "memory_superseded" },
    });
    assert.equal(supersededRows.length, 1);
    const payload = supersededRows[0]!.payload as Record<string, string>;
    const target = await memoryStore.getById(payload.targetMemoryEventId);
    const replacement = await memoryStore.getById(payload.replacementMemoryEventId);
    assert.ok(target);
    assert.ok(replacement);
    assert.equal((target.payload as { value: unknown }).value, "不吃香菜");
    assert.equal((replacement.payload as { value: unknown }).value, "不吃香菜也不吃辣");
  });

  await t.test("media mapping resolves attachments in the v2 compile", async () => {
    const mediaRef = `weixin-attachment-v1:${nonce}`;
    const source = await appendInbound(`media-${nonce}`, "看这张图", [mediaRef]);
    const fileSha256 = "f".repeat(64);
    const artifactId = `media-asset-v1:${fileSha256}`;
    await artifactStore.put({
      artifactId,
      kind: "media_asset",
      sha256: fileSha256,
      schemaVersion: 1,
      storageRef: { provider: "local-fact-ledger", key: `media_asset/${fileSha256}.bin` },
    });
    await prisma.conversationAttachmentArtifact.create({
      data: { accountId, sourceRef: mediaRef, artifactId, mimeType: "image/png" },
    });

    const compiler = createContextCompilerV1({
      conversationEventStore: eventStore,
      agentRunStore: runStore,
      artifactRevisionStore: artifactStore,
      attachmentArtifactResolver: createPrismaAttachmentArtifactResolver({
        artifactRevisionStore: artifactStore,
        injectedPrisma: prisma,
      }),
    });
    const compileInput: CompileContextInputV1 = {
      accountId,
      conversationStreamId: streamId,
      eventCursor: source.streamSeq,
      compilerVersion: CONTEXT_COMPILER_VERSION,
      contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
      effectiveTime: "2026-08-30T08:00:00.000+08:00",
      timezone: CONTEXT_TIMEZONE,
    };
    const compiled = await compiler.compile(compileInput);
    // 流里还有无媒体的普通消息——找到带媒体的那条 entry 断言
    const mediaEntry = compiled.context.entries.find((entry) => entry.attachments.length > 0);
    assert.ok(mediaEntry);
    assert.equal(mediaEntry.attachments[0]?.resolution.status, "resolved");
    assert.equal(
      (mediaEntry.attachments[0]?.resolution as { mimeType?: string }).mimeType,
      "image/png",
    );
  });

  await t.test("append-only trigger protects memory_events", async () => {
    await assert.rejects(() =>
      prisma.$executeRawUnsafe(
        `DELETE FROM "memory_events" WHERE "account_id" = '${accountId}'`,
      ),
    );
  });

  await t.test("rollout row missing means disabled", async () => {
    assert.equal(await new RunLedgerRolloutStore(prisma).isEnabled(accountId), false);
  });
});

