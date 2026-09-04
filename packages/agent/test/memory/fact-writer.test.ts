import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppendMemoryEventInput,
  MemoryEvent,
  MemoryEventStore,
  MemoryAssertionCategory,
  TapeStore,
} from "../../src/index.js";
import { setMemoryEventStore } from "../../src/ports/memory-event-store.js";
import {
  setTapeStore,
  type CreateEntryParams,
  type TapeEntryRow,
} from "../../src/ports/tape-store.js";
import { writeMemoryFactToLedger, type MemoryFactInput } from "../../src/memory/fact-writer.js";
import { GLOBAL_BRANCH } from "../../src/memory/constants.js";

/**
 * 业务需求（Phase 5 设计 §5）：
 *
 * Agent 在对话中"记住"用户告诉它的事情时，每条记忆都必须：
 *   1. 可追溯——能回答"哪次对话、哪次 run、哪个提取模型版本得出的"；
 *   2. 可替换——用户改口时旧说法被显式废弃，而不是被悄悄覆盖；
 *   3. 不重复——重复表达、断电重试都不会刷出第二条一样的记录；
 *   4. 不伪造——没有可靠出处的记忆绝不编造出处。
 *
 * 下面的用例从这些业务诉求出发，验证账本侧写入行为。
 */

// ── 测试假件：内存版 Tape / Memory Event Store ──────────────────────

type FragmentData = Record<string, unknown>;

interface FakeEntry {
  accountId: string;
  branch: string;
  type: string;
  category: string;
  payload: { fragments: Array<{ kind: string; data: FragmentData }> };
  createdAt: Date;
}

class FakeTapeStore implements TapeStore {
  entries: FakeEntry[] = [];

  // 参数兼容 Port 类型与测试便捷形状（source 可省略）
  async createEntry(
    params:
      | CreateEntryParams
      | {
          accountId: string;
          branch: string;
          type: string;
          category: string;
          payload: { fragments: Array<{ kind: string; data: FragmentData }> };
          actor: string;
        },
  ): Promise<string> {
    this.entries.push({
      accountId: params.accountId,
      branch: params.branch,
      type: params.type,
      category: params.category,
      payload: params.payload as { fragments: Array<{ kind: string; data: FragmentData }> },
      createdAt: new Date(),
    });
    return `eid-${this.entries.length}`;
  }

  async findEntries(accountId: string, branch: string): Promise<TapeEntryRow[]> {
    return this.entries
      .filter((entry) => entry.accountId === accountId && entry.branch === branch)
      .map((entry) => ({
        eid: `eid-${entry.createdAt.getTime()}`,
        branch: entry.branch,
        category: entry.category,
        payload: entry.payload,
        createdAt: entry.createdAt,
      }));
  }

  async findAllEntries(): Promise<never[]> {
    return [];
  }

  async listBranches(): Promise<string[]> {
    return [];
  }

  async findLatestAnchor(): Promise<null> {
    return null;
  }

  async listAnchors(): Promise<never[]> {
    return [];
  }

  async attachAnchorSummary(): Promise<void> {}

  async createAnchor(): Promise<string> {
    return "aid-1";
  }

  async markCompacted(): Promise<void> {}

  async compactTransaction(): Promise<void> {}

  async purgeCompacted(): Promise<number> {
    return 0;
  }
}

class FakeMemoryEventStore implements MemoryEventStore {
  /** 以 eventId 为键保存事件；append 模拟 Store 的 id-retry / 冲突语义。 */
  events = new Map<string, MemoryEvent>();
  private seq = 0;

  async append(
    input: AppendMemoryEventInput,
  ): Promise<{ value: MemoryEvent; appended: boolean }> {
    const existing = this.events.get(input.eventId);
    if (existing) {
      // 同 id 同内容 → 幂等吸收；同 id 不同内容 → 冲突（与 Prisma 实现一致）。
      if (JSON.stringify(existing.payload) === JSON.stringify(input.payload)) {
        return { value: existing, appended: false };
      }
      throw Object.assign(new Error("id conflict"), { name: "FactLedgerIdConflictError" });
    }
    const event = {
      ...input,
      memorySeq: ++this.seq,
      recordedAt: "2026-08-30T00:00:00.000Z",
    } as MemoryEvent;
    this.events.set(input.eventId, event);
    return { value: event, appended: true };
  }

  async getById(eventId: string): Promise<MemoryEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async listBranch(): Promise<MemoryEvent[]> {
    return [...this.events.values()];
  }

  async headSeq(): Promise<number> {
    return this.events.size;
  }

  async findLiveAssertionByKey(
    _accountId: string,
    branch: string,
    category: MemoryAssertionCategory,
    key: string,
  ): Promise<MemoryEvent | null> {
    const matches = [...this.events.values()]
      .filter(
        (event) =>
          event.branch === branch &&
          event.eventType === "memory_asserted" &&
          (event.payload as { category?: string; key?: string }).category === category &&
          (event.payload as { category?: string; key?: string }).key === key,
      )
      .sort((left, right) => right.memorySeq - left.memorySeq);
    return matches[0] ?? null;
  }
}

// ── 测试工具：把一条 Tape 记录播种为"已有记忆" ──────────────────────

async function seedTapeFact(
  tape: FakeTapeStore,
  input: { accountId: string; branch: string; category: string; key: string; value: unknown },
): Promise<void> {
  await tape.createEntry({
    accountId: input.accountId,
    branch: input.branch,
    type: "record",
    category: input.category,
    payload: {
      fragments: [{ kind: "text", data: { key: input.key, value: input.value } }],
    },
    actor: "test",
  });
}

function factInput(overrides: Partial<MemoryFactInput> = {}): MemoryFactInput {
  return {
    accountId: "account-1",
    branch: GLOBAL_BRANCH,
    scope: "global",
    category: "preference",
    key: "口味",
    value: "不吃香菜",
    confidence: 0.9,
    evidence: {
      sourceEventId: "inbound-1",
      runId: "run-1",
      extractionModelRevisionId: "model-config-revision-v1:abc",
      extractionPromptRevisionId: "prompt-revision-v1:abc",
    },
    ...overrides,
  };
}

function setup(): { tape: FakeTapeStore; memory: FakeMemoryEventStore } {
  const tape = new FakeTapeStore();
  const memory = new FakeMemoryEventStore();
  setTapeStore(tape);
  setMemoryEventStore(memory);
  return { tape, memory };
}

/**
 * 模拟生产队列任务的完整行为（设计 §5.1）：
 * 账本事件先写，Tape 投影随后——两者在同一任务内先后发生。
 */
async function runQueueWrite(
  tape: FakeTapeStore,
  memory: FakeMemoryEventStore,
  input: MemoryFactInput,
): Promise<ReturnType<typeof writeMemoryFactToLedger>> extends never
  ? never
  : Promise<Awaited<ReturnType<typeof writeMemoryFactToLedger>>> {
  const outcome = await writeMemoryFactToLedger({ memoryEventStore: memory }, input);
  // Tape 写入步骤（账本之后）——生产中由同一队列任务完成
  if (outcome.result === "appended" || outcome.result === "conflict") {
    await tape.createEntry({
      accountId: input.accountId,
      branch: input.branch,
      type: "record",
      category: input.category,
      payload: {
        fragments: [{ kind: "text", data: { key: input.key, value: input.value } }],
      },
      actor: "test",
    });
  }
  return outcome;
}

// ── 业务用例 ─────────────────────────────────────────────────────────

test("用户告诉 Agent 的偏好被永久记录，且能追溯到具体对话与提取模型", async () => {
  const { memory } = setup();
  const outcome = await writeMemoryFactToLedger(
    { memoryEventStore: memory },
    factInput(),
  );

  assert.equal(outcome.result, "appended");
  const event = memory.events.get(outcome.result === "appended" ? outcome.assertedEventId : "")!;
  assert.ok(event);
  const payload = event.payload as Record<string, unknown>;
  // 证据链三要素：哪次对话、哪次 run、哪个提取模型/prompt 版本
  assert.deepEqual(payload.sourceConversationEventIds, ["inbound-1"]);
  assert.equal(payload.sourceRunId, "run-1");
  assert.equal(payload.extractionModelRevisionId, "model-config-revision-v1:abc");
  assert.equal(payload.extractionPromptRevisionId, "prompt-revision-v1:abc");
  assert.equal(payload.scope, "global");
  assert.equal(payload.confidence, 0.9);
});

test("同一输入重复写入得到同一个 eventId（断电重试不产生第二份记忆）", async () => {
  const { memory } = setup();
  const first = await writeMemoryFactToLedger({ memoryEventStore: memory }, factInput());
  const second = await writeMemoryFactToLedger({ memoryEventStore: memory }, factInput());

  const firstId = first.result === "appended" ? first.assertedEventId : "";
  const secondId = second.result === "appended" ? second.assertedEventId : "";
  assert.equal(firstId, secondId);
  assert.equal(memory.events.size, 1);
});

test("用户改口时旧说法被显式废弃，新旧记忆可互相追溯", async () => {
  const { tape, memory } = setup();
  // 第一版：不吃香菜
  const first = await runQueueWrite(tape, memory, factInput());
  // 用户改口：其实也不吃辣
  const second = await runQueueWrite(tape, memory, factInput({ value: "不吃香菜也不吃辣" }));

  assert.equal(second.result, "appended");
  const superseded = [...memory.events.values()].find(
    (event) => event.eventType === "memory_superseded",
  );
  assert.ok(superseded, "值变化必须产生替换事件");
  const payload = superseded.payload as Record<string, string>;
  assert.equal(payload.targetMemoryEventId, first.result === "appended" ? first.assertedEventId : "");
  assert.equal(
    payload.replacementMemoryEventId,
    second.result === "appended" ? second.assertedEventId : "",
  );
  // 双向可解析：target 与 replacement 都能通过 id 找回真实事件
  assert.ok(memory.events.get(payload.targetMemoryEventId));
  assert.ok(memory.events.get(payload.replacementMemoryEventId));
});

test("重复表达同一事实不刷出重复记录", async () => {
  const { tape, memory } = setup();
  await seedTapeFact(tape, {
    accountId: "account-1",
    branch: GLOBAL_BRANCH,
    category: "preference",
    key: "口味",
    value: "不吃香菜",
  });
  const outcome = await writeMemoryFactToLedger({ memoryEventStore: memory }, factInput());
  assert.equal(outcome.result, "skipped_unchanged");
  assert.equal(memory.events.size, 0);
});

test("反复改主意（改回原样）不会弄丢历史，也不会撞 id", async () => {
  const { tape, memory } = setup();
  const results: string[] = [];
  for (const value of ["吃辣", "不吃辣", "吃辣"]) {
    const outcome = await runQueueWrite(tape, memory, factInput({ value }));
    results.push(outcome.result === "appended" ? outcome.assertedEventId : outcome.result);
  }
  // 三次写入产生三个不同事件（每次的前值不同），没有任何一次冲突
  assert.equal(new Set(results).size, 3);
  assert.equal(results.every((id) => id.startsWith("memory-event-v1:")), true);
  // live 断言始终是最新一次说法
  const live = await memory.findLiveAssertionByKey("account-1", GLOBAL_BRANCH, "preference", "口味");
  assert.equal((live!.payload as { value: unknown }).value, "吃辣");
});

test("没有对话出处的记忆不会被伪造出处（只写 Tape，不写账本）", async () => {
  const { memory } = setup();
  const outcome = await writeMemoryFactToLedger(
    { memoryEventStore: memory },
    factInput({ evidence: { extractionModelRevisionId: "m", extractionPromptRevisionId: "p" } }),
  );
  assert.equal(outcome.result, "skipped_no_evidence");
  assert.equal(memory.events.size, 0);
});

test("decision 类记忆是时间线：连续不同的决定不产生替换事件", async () => {
  const { memory } = setup();
  await writeMemoryFactToLedger(
    { memoryEventStore: memory },
    factInput({ category: "decision", key: "出游计划", value: "去海边" }),
  );
  await writeMemoryFactToLedger(
    { memoryEventStore: memory },
    factInput({ category: "decision", key: "出游计划", value: "改去山里" }),
  );
  const superseded = [...memory.events.values()].filter(
    (event) => event.eventType === "memory_superseded",
  );
  // 决定是先后发生的事实，不是对同一说法的修正——账本只追加断言
  assert.equal(superseded.length, 0);
  assert.equal(memory.events.size, 2);
});

test("重投重跑导致置信度抖动时，既有记录是权威版本且不崩溃", async () => {
  const { memory } = setup();
  await writeMemoryFactToLedger({ memoryEventStore: memory }, factInput({ confidence: 0.9 }));
  // 同 run 同值但 confidence 不同 → 同 id 不同 payload → 显式 conflict 而非崩溃
  const outcome = await writeMemoryFactToLedger(
    { memoryEventStore: memory },
    factInput({ confidence: 0.5 }),
  );
  assert.equal(outcome.result, "conflict");
  assert.equal(memory.events.size, 1);
});
