import assert from "node:assert/strict";
import test from "node:test";
import type {
  MemoryEventStore,
  TapeStore,
} from "../../src/index.js";
import { setMemoryEventStore } from "../../src/ports/memory-event-store.js";
import { setTapeStore } from "../../src/ports/tape-store.js";
import { readMemoryCoverage, readSummaryArtifactIds } from "../../src/engine/run-ledger/memory-bootstrap.js";
import { ARTIFACT_KIND } from "../../src/shared/fact-ledger/contracts.js";

/**
 * 业务需求（Phase 5 设计 §6）：
 *
 * 1. 每次模型调用所"看到"的记忆必须被固化下来——事后用户改了口、记忆发生了
 *    变化，也不能影响对"当时 Agent 知道什么"的追溯；
 * 2. 记忆固化是增益信息：它失败时 Agent 照常工作，只是少了可追溯性；
 * 3. 历史压缩（compaction）产生的固化点也要能被后续编译引用。
 */

function fakeMemoryStore(events: Array<{ branch: string; eventType: string; category?: string; key?: string }> = []): MemoryEventStore {
  let seq = 0;
  const rows = events.map((event, index) => ({
    eventId: `e-${index}`,
    accountId: "account-1",
    branch: event.branch,
    memorySeq: ++seq,
    eventType: event.eventType,
    schemaVersion: 1,
    occurredAt: "2026-08-30T00:00:00.000Z",
    recordedAt: "2026-08-30T00:00:00.000Z",
    actorKind: "agent",
    actorId: "account-1",
    payload: {},
    ...(event.category ? { category: event.category } : {}),
    ...(event.key ? { key: event.key } : {}),
  }));
  return {
    async append() {
      throw new Error("not used");
    },
    async getById() {
      return null;
    },
    async listBranch() {
      return rows;
    },
    async headSeq(_accountId: string, branch: string) {
      return rows.filter((row) => row.branch === branch).length;
    },
    async findLiveAssertionByKey() {
      return null;
    },
  } as unknown as MemoryEventStore;
}

function fakeTapeStore(anchors: Array<{ summaryArtifactId?: string }> = []): TapeStore {
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
      return anchors.map((anchor, index) => ({
        aid: `aid-${index}`,
        snapshot: {},
        lastEntryEid: null,
        createdAt: new Date(),
        summaryArtifactId: anchor.summaryArtifactId ?? null,
      }));
    },
    async attachAnchorSummary() {},
    async createAnchor() {
      return "aid-new";
    },
    async markCompacted() {},
    async compactTransaction() {},
    async purgeCompacted() {
      return 0;
    },
  };
}

test("编译时刻的记忆水位与快照被固化，且与事件流一致", async () => {
  const events = [
    { branch: "__global__", eventType: "memory_asserted", category: "preference", key: "口味" },
    { branch: "session-1", eventType: "memory_asserted", category: "fact", key: "城市" },
  ];
  const stored: Array<{ artifactId: string; document: unknown }> = [];
  setMemoryEventStore(fakeMemoryStore(events));
  setTapeStore(fakeTapeStore());

  const coverage = await readMemoryCoverage({
    accountId: "account-1",
    runId: "run-1",
    sessionBranch: "session-1",
    memoryEventStore: fakeMemoryStore(events),
    putArtifact: async (kind, document, options) => {
      assert.equal(kind, ARTIFACT_KIND.MEMORY_SNAPSHOT);
      assert.ok(options);
      const artifactId = options.artifactId ?? "memory-snapshot-v1:missing";
      stored.push({ artifactId, document });
      return { artifactId, sha256: "a".repeat(64) };
    },
  });

  // 水位反映两个 branch 各自的事件数
  assert.equal(coverage.watermark, "wm-v1:1/1");
  assert.ok(coverage.memoryArtifactId);
  assert.equal(coverage.memoryArtifactId, stored[0]?.artifactId);
  // 快照文档里带水位，可独立追溯
  const document = stored[0]?.document as { watermark: string };
  assert.equal(document.watermark, "wm-v1:1/1");
});

test("还没有任何记忆事件时，水位从零开始且快照仍然有效", async () => {
  setMemoryEventStore(fakeMemoryStore([]));
  setTapeStore(fakeTapeStore());
  const coverage = await readMemoryCoverage({
    accountId: "account-1",
    runId: "run-1",
    sessionBranch: "session-1",
    memoryEventStore: fakeMemoryStore([]),
    putArtifact: async (_kind, _document, options) => ({
      artifactId: options?.artifactId ?? "memory-snapshot-v1:missing",
      sha256: "a".repeat(64),
    }),
  });
  assert.equal(coverage.watermark, "wm-v1:0/0");
  assert.ok(coverage.memoryArtifactId);
});

test("记忆固化失败只损失可追溯性，绝不影响这次模型调用", async () => {
  setMemoryEventStore(fakeMemoryStore([]));
  setTapeStore(fakeTapeStore());
  const coverage = await readMemoryCoverage({
    accountId: "account-1",
    runId: "run-1",
    sessionBranch: "session-1",
    memoryEventStore: fakeMemoryStore([]),
    putArtifact: async () => {
      throw new Error("storage down");
    },
  });
  // 字段回退为不可用标记，而不是抛错打断 run
  assert.equal(coverage.watermark, "unavailable-v1");
  assert.equal(coverage.memoryArtifactId, undefined);
});

test("历史压缩产生的固化点可以被后续编译引用", async () => {
  const ids = await readSummaryArtifactIds({
    accountId: "account-1",
    sessionBranch: "session-1",
    tapeStore: fakeTapeStore([{ summaryArtifactId: "summary-v1:old" }]),
  });
  assert.deepEqual(ids, ["summary-v1:old"]);
  // 没有制品化的历史 anchor 不引用（不伪造）
  const empty = await readSummaryArtifactIds({
    accountId: "account-1",
    sessionBranch: "session-1",
    tapeStore: fakeTapeStore([{}]),
  });
  assert.deepEqual(empty, []);
});
