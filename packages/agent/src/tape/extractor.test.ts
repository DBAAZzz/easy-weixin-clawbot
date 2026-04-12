import test from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV3 } from "ai/test";
import { setTapeStore, type CreateAnchorParams, type CreateEntryParams, type TapeAnchorRow, type TapeEntryRow, type TapeStore } from "../ports/tape-store.js";
import { loadPromptAssets, setPromptAssets } from "../prompts/index.js";
import { fireExtractAndRecord } from "./extractor.js";
import { recall } from "./service.js";

function createGenerateResult(
  text: string,
): Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>> {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: 1,
        text: 1,
        reasoning: undefined,
      },
    },
    warnings: [],
  };
}

class InMemoryTapeStore implements TapeStore {
  private entries: Array<
    CreateEntryParams & {
      eid: string;
      id: bigint;
      createdAt: Date;
      compacted: boolean;
    }
  > = [];

  private anchors: Array<
    Omit<CreateAnchorParams, "lastEntryEid"> & {
      lastEntryEid: string | null;
      aid: string;
      createdAt: Date;
    }
  > = [];

  private entrySeq = 0;

  private anchorSeq = 0;

  async createEntry(params: CreateEntryParams): Promise<string> {
    const eid = `eid-${++this.entrySeq}`;
    this.entries.push({
      ...params,
      eid,
      id: BigInt(this.entrySeq),
      createdAt: new Date(),
      compacted: false,
    });
    return eid;
  }

  async findEntries(accountId: string, branch: string, afterDate?: Date): Promise<TapeEntryRow[]> {
    return this.entries
      .filter(
        (entry) =>
          entry.accountId === accountId &&
          entry.branch === branch &&
          !entry.compacted &&
          (!afterDate || entry.createdAt > afterDate),
      )
      .map((entry) => ({
        eid: entry.eid,
        branch: entry.branch,
        category: entry.category,
        payload: entry.payload,
        createdAt: entry.createdAt,
      }));
  }

  async findAllEntries(accountId: string, branch: string): Promise<TapeEntryRow[]> {
    return this.entries
      .filter(
        (entry) =>
          entry.accountId === accountId &&
          (branch === "*" || entry.branch === branch),
      )
      .map((entry) => ({
        eid: entry.eid,
        branch: entry.branch,
        category: entry.category,
        payload: entry.payload,
        createdAt: entry.createdAt,
      }));
  }

  async listBranches(accountId: string): Promise<string[]> {
    return [...new Set(this.entries.filter((entry) => entry.accountId === accountId).map((entry) => entry.branch))];
  }

  async findLatestAnchor(accountId: string, branch: string): Promise<TapeAnchorRow | null> {
    const anchor = this.anchors
      .filter((item) => item.accountId === accountId && item.branch === branch)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    if (!anchor) return null;

    return {
      aid: anchor.aid,
      snapshot: anchor.snapshot,
      lastEntryEid: anchor.lastEntryEid,
      createdAt: anchor.createdAt,
    };
  }

  async createAnchor(params: CreateAnchorParams): Promise<string> {
    const aid = `aid-${++this.anchorSeq}`;
    this.anchors.push({
      ...params,
      aid,
      createdAt: new Date(),
      lastEntryEid: params.lastEntryEid ?? null,
    });
    return aid;
  }

  async markCompacted(entryIds: bigint[]): Promise<void> {
    const ids = new Set(entryIds);
    for (const entry of this.entries) {
      if (ids.has(entry.id)) entry.compacted = true;
    }
  }

  async compactTransaction(anchorParams: CreateAnchorParams, _entryIds: bigint[]): Promise<void> {
    await this.createAnchor(anchorParams);
  }

  async purgeCompacted(): Promise<number> {
    return 0;
  }
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  await assertion();
}

test("memory extractor requests JSON structured output", async () => {
  setTapeStore(new InMemoryTapeStore());
  setPromptAssets(loadPromptAssets());

  const model = new MockLanguageModelV3({
    doGenerate: async () => createGenerateResult(JSON.stringify({ memories: [] })),
  });

  fireExtractAndRecord(
    model,
    "account-structured-output",
    "conversation-structured-output",
    {
      userText: "我爱吃青菜",
      assistantText: "你平时中意食边种青菜多啲？",
    },
    "agent:test",
  );

  await waitFor(() => {
    assert.equal(model.doGenerateCalls.length, 1);
  });

  const responseFormat = await model.doGenerateCalls[0]?.responseFormat;
  assert.equal(responseFormat?.type, "json");
});

test("memory extractor records structured preference memories", async () => {
  const store = new InMemoryTapeStore();
  setTapeStore(store);
  setPromptAssets(loadPromptAssets());

  const model = new MockLanguageModelV3({
    doGenerate: async () =>
      createGenerateResult(
        JSON.stringify({
          memories: [
            {
              category: "preference",
              scope: "global",
              key: "饮食偏好",
              value: "爱吃青菜",
              confidence: 0.98,
            },
          ],
        }),
      ),
  });

  fireExtractAndRecord(
    model,
    "account-memory-write",
    "conversation-memory-write",
    {
      userText: "我爱吃青菜",
      assistantText: "你平时中意食边种青菜多啲？",
    },
    "agent:test",
  );

  await waitFor(async () => {
    const memory = await recall("account-memory-write", "__global__");
    assert.equal(memory.preferences.get("饮食偏好")?.value, "爱吃青菜");
  });
});
