import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationEvent,
  ConversationEventStore,
  MemoryEventStore,
} from "../../src/index.js";
import { setMemoryEventStore } from "../../src/ports/memory-event-store.js";
import { setTapeStore, type TapeStore } from "../../src/ports/tape-store.js";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_TIMEZONE,
  buildContextManifestDocument,
  createContextCompilerV1,
} from "../../src/context-compiler/index.js";
import { readMemoryCoverage } from "../../src/engine/run-ledger/memory-bootstrap.js";

/**
 * 业务需求（Phase 5 设计 §9 / §11）：
 *
 * 1. coverage 描述"这次编译实际引用了什么"，给后续读取切换提供真实信号——
 *    只有真的解析出媒体制品 / 固化了记忆快照时才能报 true；
 * 2. 用户发过的图片（媒体消息）在 canonical context 里以制品身份出现，
 *    而不是永远"未解析"；
 * 3. manifest 把"编译那一刻的记忆"与"媒体制品"一起固化下来。
 */

function inbound(eventId: string, streamSeq: number, text: string, attachmentRefs: string[] = []): ConversationEvent {
  return {
    eventId,
    accountId: "account-1",
    streamId: "stream-1",
    streamSeq,
    eventType: "inbound_message_received",
    schemaVersion: 1,
    occurredAt: "2026-08-30T00:00:00.000Z",
    receivedAt: "2026-08-30T00:00:01.000Z",
    recordedAt: "2026-08-30T00:00:02.000Z",
    actor: { kind: "user", id: "user-1" },
    payload: { channel: "weixin", text, attachmentRefs },
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

import type { AgentRunEvent } from "../../src/index.js";

function makeRunEvent(
  runId: string,
  runSeq: number,
  eventType: string,
  payload: unknown,
): AgentRunEvent {
  return {
    eventId: `${runId}:${runSeq}`,
    runId,
    runSeq,
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventType,
    schemaVersion: 1,
    occurredAt: "2026-08-30T00:00:02.000Z",
    recordedAt: "2026-08-30T00:00:03.000Z",
    causationId: "e1",
    correlationId: "e1",
    payload,
  } as AgentRunEvent;
}

test("媒体制品真正解析出来时，coverage 才声明 immutableMediaArtifacts", async () => {
  const mediaRef = "weixin-attachment-v1:photo";
  const compilerWithMedia = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("e1", 1, "看这张图", [mediaRef])]),
    attachmentArtifactResolver: {
      async resolve({ sourceRefs }) {
        return sourceRefs.includes(mediaRef)
          ? new Map([[mediaRef, { artifactId: "media-asset-v1:photo-hash", mimeType: "image/png" }]])
          : new Map();
      },
    },
    artifactRevisionStore: {
      async put() {
        throw new Error("not used");
      },
      async getById(artifactId: string) {
        return {
          artifactId,
          kind: "media_asset" as const,
          sha256: "a".repeat(64),
          schemaVersion: 1,
          contentLocation: "external" as const,
          storageRef: { provider: "local", key: artifactId },
          createdAt: "2026-08-30T00:00:00.000Z",
        };
      },
      async getByContent() {
        return null;
      },
    },
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

  const compiled = await compilerWithMedia.compile({
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventCursor: 1,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
    effectiveTime: "2026-08-30T08:00:00.000+08:00",
    timezone: CONTEXT_TIMEZONE,
  });

  // 媒体以制品身份出现在 entry 上，coverage 如实声明
  assert.equal(compiled.context.entries[0]?.attachments[0]?.resolution.status, "resolved");
  assert.equal(compiled.context.coverage.immutableMediaArtifacts, true);

  // 对照组：同样的消息但映射缺失 → unresolved，coverage 不得虚报
  const compilerWithoutMapping = createContextCompilerV1({
    conversationEventStore: eventStore([inbound("e1", 1, "看这张图", [mediaRef])]),
    attachmentArtifactResolver: {
      async resolve() {
        return new Map();
      },
    },
    artifactRevisionStore: {
      async put() {
        throw new Error("not used");
      },
      async getById() {
        return null;
      },
      async getByContent() {
        return null;
      },
    },
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
  const unresolved = await compilerWithoutMapping.compile({
    accountId: "account-1",
    conversationStreamId: "stream-1",
    eventCursor: 1,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
    effectiveTime: "2026-08-30T08:00:00.000+08:00",
    timezone: CONTEXT_TIMEZONE,
  });
  assert.equal(unresolved.context.entries[0]?.attachments[0]?.resolution.status, "unresolved");
  assert.equal(unresolved.context.coverage.immutableMediaArtifacts, false);
});

function fakeTapeStore(): TapeStore {
  return {
    async createEntry() {
      return "e";
    },
    async findEntries() {
      return [];
    },
    async findAllEntries() {
      return [];
    },
    async listBranches() {
      return [];
    },
    async findLatestAnchor() {
      return null;
    },
    async listAnchors() {
      return [];
    },
    async attachAnchorSummary() {},
    async createAnchor() {
      return "aid";
    },
    async markCompacted() {},
    async compactTransaction() {},
    async purgeCompacted() {
      return 0;
    },
  };
}

test("记忆固化写入 manifest：水位、快照 id 与视觉观察一起固化", async () => {
  const memoryEvents = [
    { branch: "__global__", eventType: "memory_asserted", category: "preference", key: "口味" },
  ];
  const memoryStore: MemoryEventStore = {
    async append() {
      throw new Error("not used");
    },
    async getById() {
      return null;
    },
    async listBranch() {
      return [];
    },
    async headSeq(_accountId: string, branch: string) {
      return branch === "__global__" ? 2 : 1;
    },
    async findLiveAssertionByKey() {
      return null;
    },
  };
  void memoryEvents;
  setMemoryEventStore(memoryStore);
  setTapeStore(fakeTapeStore());

  const coverage = await readMemoryCoverage({
    accountId: "account-1",
    runId: "run-1",
    sessionBranch: "session-1",
    memoryEventStore: memoryStore,
    putArtifact: async (_kind, _document, options) => ({
      artifactId: options?.artifactId ?? "memory-snapshot-v1:fallback",
      sha256: "a".repeat(64),
    }),
  });

  const manifest = buildContextManifestDocument({
    accountId: "account-1",
    runId: "run-1",
    manifestId: "context-manifest-v1:x",
    compilerVersion: CONTEXT_COMPILER_VERSION,
    contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
    conversationEventIds: ["e1"],
    runEventIds: [],
    modelRevisionId: "model-config-revision-v1:m",
    promptRevisionId: "prompt-revision-v1:p",
    skillRevisionIds: [],
    toolRevisionIds: [],
    effectiveTime: "2026-08-30T08:00:00.000+08:00",
    timezone: CONTEXT_TIMEZONE,
    trimDecision: {
      trimLevel: 0,
      originalTokens: 10,
      trimmedTokens: 10,
      droppedMessages: 0,
      fixedOverheadTokens: 2,
    },
    canonicalRequestHash: "a".repeat(64),
    memoryEventWatermark: coverage.watermark,
    memoryArtifactId: coverage.memoryArtifactId,
    visualObservationIds: ["visual-observation-v1:pic"],
  });

  assert.equal(manifest.memoryEventWatermark, "wm-v1:2/1");
  assert.equal(manifest.memoryArtifactId, coverage.memoryArtifactId);
  assert.deepEqual(manifest.visualObservationIds, ["visual-observation-v1:pic"]);
});

test("run facts 与记忆固化同时存在时，编译身份依旧稳定", async () => {
  const _memoryStore: MemoryEventStore = {
    async append() {
      throw new Error("not used");
    },
    async getById() {
      return null;
    },
    async listBranch() {
      return [];
    },
    async headSeq() {
      return 3;
    },
    async findLiveAssertionByKey() {
      return null;
    },
  };
  const runEvent = makeRunEvent("run-1", 1, "run_started", {
    runKind: "chat",
    triggerEventId: "e1",
  });
  const runEvents = [
    runEvent,
    makeRunEvent("run-1", 2, "model_call_completed", {
      callId: "call-1",
      round: 1,
      manifestId: "m",
      responseArtifactId: "artifact-1",
    }),
    makeRunEvent("run-1", 3, "run_completed", { rounds: 1 }),
  ];

  const build = () =>
    createContextCompilerV1({
      conversationEventStore: eventStore([inbound("e1", 1, "hello")]),
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
          return runEvents;
        },
      } as import("../../src/index.js").AgentRunStore,
      artifactRevisionStore: {
        async put() {
          throw new Error("not used");
        },
        async getById(artifactId: string) {
          return {
            artifactId,
            kind: "model_response" as const,
            sha256: "a".repeat(64),
            schemaVersion: 1,
            contentLocation: "inline" as const,
            inlineJson: { role: "assistant", content: [{ type: "text", text: "reply" }] },
            createdAt: "2026-08-30T00:00:00.000Z",
          };
        },
        async getByContent() {
          return null;
        },
      },
    }).compile({
      accountId: "account-1",
      conversationStreamId: "stream-1",
      eventCursor: 1,
      compilerVersion: CONTEXT_COMPILER_VERSION,
      contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
      effectiveTime: "2026-08-30T08:00:00.000+08:00",
      timezone: CONTEXT_TIMEZONE,
      coverageHints: { memoryFacts: true, immutableMediaArtifacts: false },
    });

  const first = await build();
  const second = await build();
  assert.equal(first.canonicalContextHash, second.canonicalContextHash);
  assert.equal(first.context.coverage.memoryFacts, true);
  assert.deepEqual(
    first.context.entries.map((entry) => [entry.role, entry.text]),
    [
      ["user", "hello"],
      ["assistant", "reply"],
    ],
  );
});
