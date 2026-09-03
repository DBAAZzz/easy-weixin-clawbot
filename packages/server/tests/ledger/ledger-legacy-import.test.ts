import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ConversationEventStore } from "@clawbot/agent";
import { importLegacyTranscript } from "../../src/ledger-legacy-import.js";

/**
 * Minimal prisma double covering the queries importLegacyTranscript issues.
 * `scenario` picks which boundary rule the fake data exercises.
 */
function fakePrisma(scenario: {
  hasBoundary?: boolean;
  headSeq?: number;
  minLinkSeq?: number | null;
  messages?: Array<{ seq: number; role: string; createdAt: Date; payload: unknown }>;
}) {
  const messages = scenario.messages ?? [];
  return {
    conversationEvent: {
      async findFirst({ where }: { where: { eventType: string } }) {
        if (where.eventType === "session_rotated" && scenario.hasBoundary) {
          return { eventId: "boundary-1" };
        }
        return null;
      },
    },
    conversationStreamHead: {
      async findUnique() {
        return { lastSeq: scenario.headSeq ?? 0 };
      },
    },
    legacyMessageProjectionLink: {
      async findFirst() {
        return scenario.minLinkSeq ? { messageSeq: scenario.minLinkSeq } : null;
      },
    },
    message: {
      async findMany({ where }: { where?: { seq?: { lt?: number } } }) {
        const lt = where?.seq?.lt;
        return messages.filter((row) => (lt === undefined ? true : row.seq < lt));
      },
    },
  } as unknown as PrismaClient;
}

const STORE_APPEND_OK = {
  async append(input: unknown) {
    return { value: input, appended: true };
  },
} as unknown as ConversationEventStore;

function row(seq: number, role: string, payload: unknown) {
  return { seq, role, createdAt: new Date("2026-08-01T08:00:00.000Z"), payload };
}

test("无 link 且零事件的流：全部 messages 导入为单条 partial 批量事件", async () => {
  const appended: unknown[] = [];
  const store = {
    async append(input: unknown) {
      appended.push(input);
      return { value: input, appended: true };
    },
  } as unknown as ConversationEventStore;
  const result = await importLegacyTranscript({
    accountId: "account-1",
    conversationId: "conv-1",
    maxEntries: 500,
    dryRun: false,
    injectedPrisma: fakePrisma({
      headSeq: 0,
      messages: [
        row(1, "user", {
          content: [
            { type: "text", text: "[当前时间: 2026-08-01 16:00]\n你好" },
            { type: "image", assetId: "asset-1" },
          ],
        }),
        row(2, "assistant", { content: [{ type: "text", text: "你好！" }] }),
      ],
    }),
    conversationEventStore: store,
  });

  assert.equal(result.result, "appended");
  assert.equal(result.entryCount, 2);
  assert.equal(result.omittedEntryCount, 0);
  const event = appended[0] as {
    eventId: string;
    payload: { reconstructability: string; entries: Array<Record<string, unknown>> };
  };
  assert.match(event.eventId, /^legacy-import-v1:[0-9a-f]{64}$/);
  assert.equal(event.payload.reconstructability, "partial");
  assert.equal(event.payload.entries[0].text, "[当前时间: 2026-08-01 16:00]\n你好");
  assert.deepEqual(event.payload.entries[0].attachmentRefs, ["asset-1"]);
});

test("有 link：只导入 link 之前的行；toolResult 与 assistant 的 toolCall 配对", async () => {
  const appended: unknown[] = [];
  const store = {
    async append(input: unknown) {
      appended.push(input);
      return { value: input, appended: true };
    },
  } as unknown as ConversationEventStore;
  const result = await importLegacyTranscript({
    accountId: "account-1",
    conversationId: "conv-1",
    maxEntries: 500,
    dryRun: false,
    injectedPrisma: fakePrisma({
      headSeq: 10,
      minLinkSeq: 3,
      messages: [
        row(1, "assistant", {
          content: [
            { type: "toolCall", id: "call-9", name: "weather", arguments: { city: "上海" } },
          ],
        }),
        row(2, "toolResult", { toolCallId: "call-9", isError: true, content: [{ type: "text", text: "boom" }] }),
        row(3, "user", { content: [{ type: "text", text: "link 之后" }] }),
      ],
    }),
    conversationEventStore: store,
  });

  assert.equal(result.result, "appended");
  const event = appended[0] as { payload: { entries: Array<Record<string, unknown>> } };
  assert.deepEqual(
    event.payload.entries.map((entry) => [entry.role, entry.sourceMessageSeq]),
    [["assistant", 1], ["tool", 2]],
  );
  const toolEntry = event.payload.entries[1];
  assert.equal(toolEntry.callId, "call-9");
  assert.equal(toolEntry.toolName, "weather");
  assert.equal(toolEntry.toolArguments, '{"city":"上海"}');
  assert.equal(toolEntry.toolError, true);
});

test("流上有事件但无 link → refused_no_boundary；有 boundary → skipped_cleared", async () => {
  const refused = await importLegacyTranscript({
    accountId: "account-1",
    conversationId: "conv-1",
    maxEntries: 500,
    dryRun: false,
    injectedPrisma: fakePrisma({ headSeq: 7 }),
    conversationEventStore: STORE_APPEND_OK,
  });
  assert.equal(refused.result, "refused_no_boundary");

  const cleared = await importLegacyTranscript({
    accountId: "account-1",
    conversationId: "conv-1",
    maxEntries: 500,
    dryRun: false,
    injectedPrisma: fakePrisma({ hasBoundary: true, headSeq: 0 }),
    conversationEventStore: STORE_APPEND_OK,
  });
  assert.equal(cleared.result, "skipped_cleared");
});

test("超出单批容量：省略最旧条目并显式计数", async () => {
  const appended: unknown[] = [];
  const store = {
    async append(input: unknown) {
      appended.push(input);
      return { value: input, appended: true };
    },
  } as unknown as ConversationEventStore;
  const messages = [1, 2, 3, 4, 5].map((seq) =>
    row(seq, "user", { content: [{ type: "text", text: `m${seq}` }] }),
  );
  const result = await importLegacyTranscript({
    accountId: "account-1",
    conversationId: "conv-1",
    maxEntries: 3,
    dryRun: false,
    injectedPrisma: fakePrisma({ headSeq: 0, messages }),
    conversationEventStore: store,
  });

  assert.equal(result.result, "appended");
  assert.equal(result.omittedEntryCount, 2);
  const event = appended[0] as { payload: { entries: Array<Record<string, unknown>>; omittedEntryCount: number } };
  assert.deepEqual(
    event.payload.entries.map((entry) => entry.text),
    ["m3", "m4", "m5"],
  );
  assert.equal(event.payload.omittedEntryCount, 2);
});
