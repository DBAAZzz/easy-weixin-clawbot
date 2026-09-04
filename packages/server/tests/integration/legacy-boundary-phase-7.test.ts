/**
 * Phase 7 integration (design §13.3): legacy transcript import → policy v4
 * compilation → canonical rebuild with tool pairing → session-boundary drop →
 * memory import + events projection replay — all on a disposable PostgreSQL
 * with the full Phase 0–7 migration chain applied.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V3,
  CONTEXT_POLICY_REVISION_ID_V4,
  CONTEXT_TIMEZONE,
  buildCanonicalHistory,
  replayMemoryProjection,
  type CompileContextInputV1,
} from "@clawbot/agent";
import { PrismaClient } from "@prisma/client";
import { PrismaAgentRunStore } from "../../src/db/agent-run-store.impl.js";
import { PrismaArtifactRevisionStore } from "../../src/db/artifact-revision-store.impl.js";
import { PrismaConversationEventStore } from "../../src/db/conversation-event-store.impl.js";
import { PrismaMemoryEventStore } from "../../src/db/memory-event-store.impl.js";
import { PrismaTapeStore } from "../../src/db/tape-store.impl.js";
import { RunLedgerRolloutStore } from "../../src/db/run-ledger-rollout-store.js";
import { importLegacyTranscript } from "../../src/ledger-legacy-import.js";
import { importMemoryBranch } from "../../src/ledger-memory-import.js";

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
const memoryEventStore = new PrismaMemoryEventStore(prisma);
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const accountId = `phase7-${nonce}`;
const streamId = `conv-${nonce}`;
const memoryBranch = `branch-${nonce}`;

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

function compileInput(overrides: Partial<CompileContextInputV1> = {}): CompileContextInputV1 {
  return {
    accountId,
    conversationStreamId: streamId,
    eventCursor: 10,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V4,
    effectiveTime: "2026-09-03T10:00:00.000Z",
    timezone: CONTEXT_TIMEZONE,
    ...overrides,
  };
}

const LEGACY_CREATED_AT = new Date("2026-08-01T08:00:00.000Z");

async function seedLegacyMessages(): Promise<void> {
  const rows = [
    {
      seq: 1,
      role: "user",
      payload: {
        content: [
          { type: "text", text: "[当前时间: 2026-08-01 16:00]\n<memory>…</memory>\n你好" },
          { type: "image", assetId: "asset-1" },
        ],
      },
    },
    { seq: 2, role: "assistant", payload: { content: [{ type: "text", text: "你好！" }] } },
    {
      seq: 3,
      role: "assistant",
      payload: {
        content: [{ type: "toolCall", id: "call-1", name: "weather", arguments: { city: "上海" } }],
      },
    },
    {
      seq: 4,
      role: "toolResult",
      payload: { toolCallId: "call-1", toolName: "weather", isError: false, content: [{ type: "text", text: "晴" }] },
    },
    { seq: 5, role: "trigger", payload: { content: [{ type: "text", text: "主动关怀" }] } },
  ];
  for (const row of rows) {
    await prisma.message.create({
      data: {
        accountId,
        conversationId: streamId,
        seq: row.seq,
        role: row.role,
        payload: row.payload as never,
        createdAt: LEGACY_CREATED_AT,
      },
    });
  }
}

test("legacy import: 全部 messages 导入为单条 partial 批量事件，且幂等", async () => {
  await ensureAccount();
  await seedLegacyMessages();

  const first = await importLegacyTranscript({
    accountId,
    conversationId: streamId,
    maxEntries: 500,
    dryRun: false,
    injectedPrisma: prisma,
    conversationEventStore: eventStore,
  });
  assert.equal(first.result, "appended");
  assert.equal(first.entryCount, 5);

  const stored = await prisma.conversationEvent.findFirst({
    where: { accountId, streamId, eventType: "legacy_transcript_imported" },
  });
  assert.ok(stored);
  const payload = stored.payload as {
    reconstructability: string;
    boundaryMessageSeq: number;
    entries: Array<{ role: string; sourceMessageSeq: number }>;
  };
  assert.equal(payload.reconstructability, "partial");
  assert.equal(payload.boundaryMessageSeq, 5);
  assert.equal(payload.entries.length, 5);

  // Idempotent re-run: deterministic id + payload → id-retry absorbs it.
  const second = await importLegacyTranscript({
    accountId,
    conversationId: streamId,
    maxEntries: 500,
    dryRun: false,
    injectedPrisma: prisma,
    conversationEventStore: eventStore,
  });
  assert.equal(second.result, "skipped_imported");
});

test("policy v4 编译含 legacy 条目且先于事实条目；v3 过滤；canonical 重建保持 tool 配对", async () => {
  const appended = await eventStore.append({
    eventId: `inbound-${nonce}`,
    accountId,
    streamId,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-09-03T09:59:00.000Z",
    receivedAt: "2026-09-03T09:59:01.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { channel: "weixin", text: "今天天气如何", attachmentRefs: [] },
  });
  const cursor = appended.value.streamSeq;

  const compilerFactory = () => {
    // agent.ts 生产接线同款（v4 + run facts）。
    return {
      compile: (input: CompileContextInputV1) =>
        import("@clawbot/agent").then(({ createContextCompilerV1 }) =>
          createContextCompilerV1({
            conversationEventStore: eventStore,
            agentRunStore: runStore,
            artifactRevisionStore: artifactStore,
          }).compile(input),
        ),
    };
  };
  const compiler = await compilerFactory();

  const compiledV4 = await compiler.compile(compileInput({ eventCursor: cursor }));
  const roles = compiledV4.context.entries.map((entry) => [entry.role, entry.streamSeq]);
  // legacy block first (seq 0), fact entry last
  assert.deepEqual(roles.slice(0, 5), [
    ["user", 0],
    ["assistant", 0],
    ["assistant", 0],
    ["tool", 0],
    ["trigger", 0],
  ]);
  assert.deepEqual(roles.at(-1), ["user", cursor]);
  assert.ok(compiledV4.context.entries.every(
    (entry) => entry.streamSeq !== 0 || entry.reconstructability === "partial",
  ));

  // v3 on the same stream filters the legacy block (regression anchor).
  const compilerV3 = await (async () => {
    const { createContextCompilerV1 } = await import("@clawbot/agent");
    return createContextCompilerV1({
      conversationEventStore: eventStore,
      agentRunStore: runStore,
      artifactRevisionStore: artifactStore,
    });
  })();
  const compiledV3 = await compilerV3.compile(
    compileInput({ eventCursor: cursor, contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V3 }),
  );
  assert.ok(compiledV3.context.entries.every((entry) => entry.reconstructability === undefined));
  assert.equal(compiledV3.context.entries.length, 1);

  // canonical rebuild keeps the legacy tool pairing valid.
  const build = await buildCanonicalHistory({
    accountId,
    compileContext: () => compiler.compile(compileInput({ eventCursor: cursor })),
    supportsImageInput: false,
  });
  const toolResult = build.messages.find((message) => message.role === "toolResult");
  assert.ok(toolResult, "legacy tool result survives the rebuild");
  const assistantWithCall = build.messages.find(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === "toolCall"),
  );
  assert.ok(assistantWithCall, "legacy tool-call round is re-expanded");

  // legacy user image without a Phase-5 mapping → explicit placeholder text.
  const legacyUser = build.messages.find(
    (message) =>
      message.role === "user" &&
      JSON.stringify(message.content).includes("你好") &&
      JSON.stringify(message.content).includes("<memory>"),
  );
  assert.ok(legacyUser);
  assert.match(JSON.stringify(legacyUser.content), /图片消息：媒体内容未重放/);
});

test("session boundary 后 legacy 条目整体消失", async () => {
  const head = await eventStore.getStreamHeadSeq(accountId, streamId);
  assert.ok(head !== undefined);
  await eventStore.append({
    eventId: `boundary-${nonce}`,
    accountId,
    streamId,
    eventType: "session_rotated",
    schemaVersion: 1,
    occurredAt: "2026-09-03T10:05:00.000Z",
    receivedAt: "2026-09-03T10:05:00.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { previousStreamId: streamId, reason: "user_clear" },
  });

  const { createContextCompilerV1 } = await import("@clawbot/agent");
  const compiler = createContextCompilerV1({
    conversationEventStore: eventStore,
    agentRunStore: runStore,
    artifactRevisionStore: artifactStore,
  });
  const cursor = await eventStore.getStreamHeadSeq(accountId, streamId);
  const compiled = await compiler.compile(compileInput({ eventCursor: cursor }));
  assert.ok(
    compiled.context.entries.every((entry) => entry.reconstructability === undefined),
    "cleared semantics hide the legacy block",
  );
});

test("memory import：Tape 状态固化为快照 + 事件重放得到等价投影", async () => {
  // Seed Tape entries directly (record entries the extractor would produce).
  await prisma.tapeEntry.create({
    data: {
      accountId,
      branch: memoryBranch,
      type: "record",
      category: "fact",
      payload: {
        fragments: [{ kind: "text", data: { key: "city", value: "上海", confidence: 0.9 } }],
      } as never,
      actor: `agent:test`,
      source: "chat",
    },
  });
  await prisma.tapeEntry.create({
    data: {
      accountId,
      branch: memoryBranch,
      type: "record",
      category: "preference",
      payload: {
        fragments: [{ kind: "text", data: { key: "口味", value: "清淡" } }],
      } as never,
      actor: `agent:test`,
      source: "chat",
    },
  });

  const result = await importMemoryBranch({
    accountId,
    branch: memoryBranch,
    dryRun: false,
    injectedPrisma: prisma,
    artifactRevisionStore: artifactStore,
    memoryEventStore,
    tapeStore: new PrismaTapeStore(prisma),
  });
  assert.equal(result.result, "appended");

  const state = await replayMemoryProjection({
    accountId,
    branch: memoryBranch,
    memoryEventStore,
    artifactRevisionStore: artifactStore,
  });
  assert.equal(state.facts.get("city")?.value, "上海");
  assert.equal(state.preferences.get("口味")?.value, "清淡");
  // Pre-import memory_asserted events are absent by construction here; the
  // snapshot is the base and replay equals the seeded Tape content.
  assert.equal(state.decisions.length, 0);
});

test("rollout 新列默认值与读取", async () => {
  const store = new RunLedgerRolloutStore(prisma);
  assert.equal(await store.legacyWriteMode(`unknown-${nonce}`), "prompt_shaped");
  assert.equal(await store.memoryReadPath(`unknown-${nonce}`), "tape");

  await prisma.runLedgerRollout.create({
    data: { accountId, enabled: true, legacyWriteMode: "clean", memoryReadPath: "dual" },
  });
  assert.equal(await store.legacyWriteMode(accountId), "clean");
  assert.equal(await store.memoryReadPath(accountId), "dual");
});
