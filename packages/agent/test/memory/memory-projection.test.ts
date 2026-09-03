import assert from "node:assert/strict";
import test from "node:test";
import type { ArtifactRevisionStore } from "../../src/ports/artifact-revision-store.js";
import type { MemoryEvent, MemoryEventStore } from "../../src/ports/memory-event-store.js";
import { MEMORY_EVENT_TYPE } from "../../src/shared/fact-ledger/contracts.js";
import {
  MemoryProjectionError,
  replayMemoryProjection,
} from "../../src/memory/memory-projection.js";

let seqCounter = 0;

function memoryEvent(input: {
  eventType: MemoryEvent["eventType"];
  payload: unknown;
  branch?: string;
  occurredAt?: string;
  memorySeq?: number;
}): MemoryEvent {
  seqCounter += 1;
  return {
    eventId: `memory-event-${seqCounter}`,
    eventType: input.eventType,
    schemaVersion: 1,
    accountId: "account-1",
    branch: input.branch ?? "session-1",
    memorySeq: input.memorySeq ?? seqCounter,
    occurredAt: input.occurredAt ?? "2026-09-02T08:00:00.000Z",
    recordedAt: "2026-09-02T08:00:01.000Z",
    actor: { kind: "agent", id: "account-1" },
    payload: input.payload,
  } as unknown as MemoryEvent;
}

function assertion(overrides: Record<string, unknown> = {}) {
  return {
    category: "fact",
    scope: "session",
    key: "city",
    value: "上海",
    confidence: 0.9,
    sourceConversationEventIds: ["inbound-1"],
    ...overrides,
  };
}

function fakeStores(events: MemoryEvent[], artifacts: Map<string, unknown> = new Map()) {
  const memoryEventStore = {
    async listBranch() {
      return events;
    },
    async headSeq() {
      return events.length;
    },
  } as unknown as MemoryEventStore;
  const artifactRevisionStore = {
    async getById(artifactId: string) {
      const doc = artifacts.get(artifactId);
      return doc === undefined
        ? null
        : { artifactId, kind: "summary", sha256: "x", schemaVersion: 1, inlineJson: doc };
    },
  } as unknown as ArtifactRevisionStore;
  return { memoryEventStore, artifactRevisionStore };
}

test("asserted/superseded/retracted 折叠为当前记忆状态", async () => {
  seqCounter = 0;
  const events = [
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ key: "city", value: "北京" }),
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ category: "preference", key: "口味", value: "清淡", confidence: undefined }),
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ key: "city", value: "上海" }),
      occurredAt: "2026-09-02T09:00:00.000Z",
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_SUPERSEDED,
      payload: {
        targetMemoryEventId: "memory-event-1",
        replacementMemoryEventId: "memory-event-3",
        reason: "value_updated",
      },
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ category: "preference", key: "过时项", value: "x" }),
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_RETRACTED,
      payload: { targetMemoryEventId: "memory-event-5", reason: "user_request" },
    }),
  ];

  const { memoryEventStore, artifactRevisionStore } = fakeStores(events);
  const state = await replayMemoryProjection({
    accountId: "account-1",
    branch: "session-1",
    memoryEventStore,
    artifactRevisionStore,
  });

  assert.equal(state.facts.get("city")?.value, "上海");
  assert.equal(state.facts.get("city")?.sourceEid, "memory-event-3");
  assert.equal(state.preferences.get("口味")?.value, "清淡");
  assert.equal(state.preferences.has("过时项"), false, "retracted entries disappear");
});

test("decision 断言进入时间线（description=value, context=key）", async () => {
  seqCounter = 0;
  const events = [
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ category: "decision", key: "聚会", value: "去公园野餐" }),
    }),
  ];
  const { memoryEventStore, artifactRevisionStore } = fakeStores(events);
  const state = await replayMemoryProjection({
    accountId: "account-1",
    branch: "session-1",
    memoryEventStore,
    artifactRevisionStore,
  });
  assert.equal(state.decisions.length, 1);
  assert.equal(state.decisions[0].description, "去公园野餐");
  assert.equal(state.decisions[0].context, "聚会");
});

test("anchor/import base 重置：快照后仅应用 throughMemorySeq 之后的事件", async () => {
  seqCounter = 0;
  const snapshotState = {
    facts: { city: { key: "city", value: " Snapshot", confidence: 1, sourceEid: "e0", updatedAt: "t0" } },
    preferences: {},
    decisions: [],
    version: 7,
  };
  const artifacts = new Map([["snapshot-artifact-1", { state: snapshotState }]]);
  const events = [
    // pre-base assertion (seq 1) — contained in the snapshot, must be skipped
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ key: "stale", value: "x" }),
      memorySeq: 1,
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_IMPORTED,
      payload: {
        source: "tape_projection",
        reconstructability: "partial",
        snapshotArtifactId: "snapshot-artifact-1",
        throughMemorySeq: 1,
      },
      memorySeq: 2,
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ key: "city", value: "上海" }),
      memorySeq: 3,
      occurredAt: "2026-09-02T10:00:00.000Z",
    }),
  ];

  const { memoryEventStore, artifactRevisionStore } = fakeStores(events, artifacts);
  const state = await replayMemoryProjection({
    accountId: "account-1",
    branch: "session-1",
    memoryEventStore,
    artifactRevisionStore,
  });

  assert.equal(state.facts.has("stale"), false, "pre-base events are skipped");
  assert.equal(state.facts.get("city")?.value, "上海", "post-base assertions apply");
  assert.equal(state.version, 7);
});

test("快照制品缺失时抛错（调用方 fail-open 回 Tape）", async () => {
  seqCounter = 0;
  const events = [
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_IMPORTED,
      payload: {
        source: "tape_projection",
        reconstructability: "partial",
        snapshotArtifactId: "missing",
        throughMemorySeq: 0,
      },
    }),
  ];
  const { memoryEventStore, artifactRevisionStore } = fakeStores(events);
  await assert.rejects(
    () =>
      replayMemoryProjection({
        accountId: "account-1",
        branch: "session-1",
        memoryEventStore,
        artifactRevisionStore,
      }),
    (error: unknown) => error instanceof MemoryProjectionError && error.code === "snapshot_artifact_missing",
  );
});

test("memory_corrected_by_user 以 replacement 覆盖目标", async () => {
  seqCounter = 0;
  const events = [
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
      payload: assertion({ key: "city", value: "北京" }),
    }),
    memoryEvent({
      eventType: MEMORY_EVENT_TYPE.MEMORY_CORRECTED_BY_USER,
      payload: {
        targetMemoryEventId: "memory-event-1",
        sourceConversationEventId: "inbound-2",
        replacement: assertion({ key: "city", value: "杭州" }),
      },
    }),
  ];
  const { memoryEventStore, artifactRevisionStore } = fakeStores(events);
  const state = await replayMemoryProjection({
    accountId: "account-1",
    branch: "session-1",
    memoryEventStore,
    artifactRevisionStore,
  });
  assert.equal(state.facts.get("city")?.value, "杭州");
});
