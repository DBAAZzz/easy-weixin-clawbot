import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type {
  ArtifactRevisionStore,
  MemoryEventStore,
} from "@clawbot/agent";
import { importMemoryBranch } from "./ledger-memory-import.js";

function fakePrisma(newestEntry: { createdAt: Date } | null) {
  return {
    tapeEntry: {
      async findFirst() {
        return newestEntry;
      },
    },
  } as unknown as PrismaClient;
}

function fakeArtifactStore() {
  const puts: unknown[] = [];
  return {
    puts,
    async put(input: unknown) {
      puts.push(input);
      return { value: input as never, appended: true };
    },
    async getById() {
      return null;
    },
  } as unknown as ArtifactRevisionStore & { puts: unknown[] };
}

function fakeMemoryStore(options: { alreadyImported?: boolean } = {}) {
  const appends: unknown[] = [];
  return {
    appends,
    async append(input: unknown) {
      appends.push(input);
      return { value: input as never, appended: true };
    },
    async getById() {
      return options.alreadyImported ? ({ eventId: "existing" } as never) : null;
    },
    async headSeq() {
      return 12;
    },
  } as unknown as MemoryEventStore & { appends: unknown[] };
}

test("importMemoryBranch 固化快照制品 + memory_imported 事件（partial, throughMemorySeq）", async () => {
  // importMemoryBranch resolves recall() from the TapeStore port; provide a
  // fake TapeStore implementing the small surface recall needs.
  const artifactStore = fakeArtifactStore();
  const memoryStore = fakeMemoryStore();
  const { setTapeStore } = await import("@clawbot/agent");
  const entries = [
    {
      eid: "e1",
      branch: "session-1",
      type: "record",
      category: "fact",
      payload: { fragments: [{ kind: "text", data: { key: "city", value: "上海", confidence: 0.9 } }] },
      createdAt: new Date("2026-09-02T08:00:00.000Z"),
    },
  ];
  setTapeStore({
    async findLatestAnchor() {
      return null;
    },
    async findEntries() {
      return entries;
    },
  } as never);

  const result = await importMemoryBranch({
    accountId: "account-1",
    branch: "session-1",
    dryRun: false,
    injectedPrisma: fakePrisma({ createdAt: new Date("2026-09-02T08:00:00.000Z") }),
    artifactRevisionStore: artifactStore,
    memoryEventStore: memoryStore,
  });

  assert.equal(result.result, "appended");
  assert.match(result.eventId, /^memory-import-v1:[0-9a-f]{64}$/);
  const put = artifactStore.puts[0] as { kind: string; inlineJson: { state: unknown } };
  assert.equal(put.kind, "memory_snapshot");
  assert.ok(put.inlineJson.state);
  const event = memoryStore.appends[0] as { eventType: string; payload: Record<string, unknown> };
  assert.equal(event.eventType, "memory_imported");
  assert.equal(event.payload.reconstructability, "partial");
  assert.equal(event.payload.throughMemorySeq, 12);
});

test("已导入分支重跑 → skipped_imported，且不重复写制品/事件", async () => {
  const { setTapeStore } = await import("@clawbot/agent");
  setTapeStore({
    async findLatestAnchor() {
      return null;
    },
    async findEntries() {
      return [
        {
          eid: "e1",
          branch: "session-1",
          type: "record",
          category: "fact",
          payload: {
            fragments: [{ kind: "text", data: { key: "city", value: "上海", confidence: 0.9 } }],
          },
          createdAt: new Date("2026-09-02T08:00:00.000Z"),
        },
      ];
    },
  } as never);

  const artifactStore = fakeArtifactStore();
  const memoryStore = fakeMemoryStore({ alreadyImported: true });
  const result = await importMemoryBranch({
    accountId: "account-1",
    branch: "session-1",
    dryRun: false,
    injectedPrisma: fakePrisma({ createdAt: new Date("2026-09-02T08:00:00.000Z") }),
    artifactRevisionStore: artifactStore,
    memoryEventStore: memoryStore,
  });

  assert.equal(result.result, "skipped_imported");
  assert.equal(artifactStore.puts.length, 0);
  assert.equal(memoryStore.appends.length, 0);
});

test("dry-run 不写制品、不写事件", async () => {
  const { setTapeStore } = await import("@clawbot/agent");
  setTapeStore({
    async findLatestAnchor() {
      return null;
    },
    async findEntries() {
      return [
        {
          eid: "e1",
          branch: "session-1",
          type: "record",
          category: "fact",
          payload: {
            fragments: [{ kind: "text", data: { key: "city", value: "上海", confidence: 0.9 } }],
          },
          createdAt: new Date("2026-09-02T08:00:00.000Z"),
        },
      ];
    },
  } as never);

  const artifactStore = fakeArtifactStore();
  const memoryStore = fakeMemoryStore();
  const result = await importMemoryBranch({
    accountId: "account-1",
    branch: "session-1",
    dryRun: true,
    injectedPrisma: fakePrisma({ createdAt: new Date("2026-09-02T08:00:00.000Z") }),
    artifactRevisionStore: artifactStore,
    memoryEventStore: memoryStore,
  });

  assert.equal(result.result, "dry_run");
  assert.equal(artifactStore.puts.length, 0);
  assert.equal(memoryStore.appends.length, 0);
});

test("空分支跳过", async () => {
  const { setTapeStore } = await import("@clawbot/agent");
  setTapeStore({
    async findLatestAnchor() {
      return null;
    },
    async findEntries() {
      return [];
    },
  } as never);

  const result = await importMemoryBranch({
    accountId: "account-1",
    branch: "empty-branch",
    dryRun: false,
    injectedPrisma: fakePrisma(null),
    artifactRevisionStore: fakeArtifactStore(),
    memoryEventStore: fakeMemoryStore(),
  });
  assert.equal(result.result, "skipped_empty");
});
