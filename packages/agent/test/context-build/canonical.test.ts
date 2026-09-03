import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import type { CompiledContextV1 } from "../../src/context-compiler/types.js";
import type { ArtifactRevisionStore } from "../../src/ports/artifact-revision-store.js";
import type { ArtifactContentSink } from "../../src/ports/artifact-content-sink.js";
import {
  buildCanonicalHistory,
  canonicalMessagesHash,
  compareDualHistories,
  compareDualHistories as compare,
} from "../../src/engine/context-build/index.js";
import type { AgentMessage } from "../../src/llm/types.js";

function compiledWith(
  entries: CompiledContextV1["context"]["entries"],
): CompiledContextV1 {
  return {
    context: {
      schemaVersion: 1,
      compilerVersion: "context-compiler-v1",
      contextPolicyRevisionId: "context-policy-v3",
      accountId: "account-1",
      conversationStreamId: "stream-1",
      eventCursor: 10,
      entries,
      runtimeContext: { effectiveTime: "2026-08-30T10:00:00.000Z", timezone: "Asia/Shanghai" },
      coverage: {
        conversationFacts: true,
        assistantRunFacts: true,
        toolRunFacts: true,
        memoryFacts: false,
        immutableMediaArtifacts: false,
      },
    },
    diagnostics: [],
    canonicalContextHash: "hash",
    conversationEventIds: [],
    runEntrySourceIds: [],
  };
}

function baseDeps(overrides: Partial<Parameters<typeof buildCanonicalHistory>[0]> = {}) {
  return {
    accountId: "account-1",
    compileContext: () => Promise.resolve(compiledWith([])),
    supportsImageInput: true,
    ...overrides,
  };
}

const text = (t: string) => ({ type: MESSAGE_CONTENT_TYPE.TEXT, text: t }) as const;

test("user/assistant/tool/trigger entries map to the documented AgentMessage roles", async () => {
  const { messages } = await buildCanonicalHistory(
    baseDeps({
      compileContext: () =>
        Promise.resolve(
          compiledWith([
            {
              eventId: "e1",
              streamSeq: 1,
              role: "user",
              occurredAt: "2026-08-30T09:00:00.000Z",
              text: "在吗",
              attachments: [],
            },
            {
              eventId: "run-1:1",
              streamSeq: 1,
              role: "trigger",
              occurredAt: "2026-08-30T10:00:00.000Z",
              text: "[当前时间] 记得提醒我",
              attachments: [],
              runId: "run-1",
              runSeq: 1,
            },
            {
              eventId: "run-1:2",
              streamSeq: 1,
              role: "assistant",
              occurredAt: "2026-08-30T10:00:01.000Z",
              text: "",
              attachments: [],
              runId: "run-1",
              runSeq: 2,
              callId: "call-1",
            },
            {
              eventId: "run-1:3",
              streamSeq: 1,
              role: "tool",
              occurredAt: "2026-08-30T10:00:02.000Z",
              text: "提醒已设置",
              attachments: [],
              runId: "run-1",
              runSeq: 3,
              callId: "tc-1",
              toolName: "scheduler_create",
              toolArguments: '{"when":"tomorrow"}',
              toolError: false,
            },
            {
              eventId: "run-1:4",
              streamSeq: 1,
              role: "assistant",
              occurredAt: "2026-08-30T10:00:03.000Z",
              text: "好的，已提醒",
              attachments: [],
              runId: "run-1",
              runSeq: 4,
              callId: "call-2",
            },
          ]),
        ),
    }),
  );

  assert.equal(messages.length, 5);
  const [user, trigger, assistantWithTool] = messages;

  assert.equal(user.role, MESSAGE_ROLE.USER);
  assert.deepEqual((user as { content: unknown[] }).content, [text("在吗")]);

  assert.equal(trigger.role, MESSAGE_ROLE.TRIGGER);
  assert.deepEqual((trigger as { content: unknown[] }).content, [text("[当前时间] 记得提醒我")]);
  assert.deepEqual((trigger as { meta: unknown }).meta, { kind: "pulse" });

  // 中间轮 assistant：空文本 + 重建的 tool_call 块（配对保持）。
  assert.equal(assistantWithTool.role, MESSAGE_ROLE.ASSISTANT);
  const toolCallBlocks = (
    assistantWithTool as { content: Array<{ type: string; id?: string; name?: string; arguments?: unknown }> }
  ).content.filter((block) => block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL);
  assert.deepEqual(toolCallBlocks, [
    {
      type: MESSAGE_CONTENT_TYPE.TOOL_CALL,
      id: "tc-1",
      name: "scheduler_create",
      arguments: { when: "tomorrow" },
    },
  ]);

  const toolResult = messages.find((message) => message.role === MESSAGE_ROLE.TOOL_RESULT);
  assert.ok(toolResult);
  assert.equal((toolResult as { toolCallId: string }).toolCallId, "tc-1");
  assert.equal((toolResult as { toolName: string }).toolName, "scheduler_create");
  assert.equal((toolResult as { isError: boolean }).isError, false);
  const finalAssistant = messages[4];
  assert.equal(finalAssistant.role, MESSAGE_ROLE.ASSISTANT);
});

test("media replay follows the CURRENT model capability, not history (§7.3)", async () => {
  const artifactRevisionStore: ArtifactRevisionStore = {
    async put() {
      throw new Error("not used");
    },
    async getById(artifactId: string) {
      return {
        artifactId,
        kind: "media_asset",
        sha256: "a".repeat(64),
        schemaVersion: 1,
        storageRef: { provider: "local", key: "media_asset/abc.bin" },
        createdAt: "2026-08-30T00:00:00.000Z",
      };
    },
    async getByContent() {
      return null;
    },
  };
  const contentSink: ArtifactContentSink = {
    async put() {
      throw new Error("not used");
    },
    async get() {
      return new Uint8Array([1, 2, 3]);
    },
  };
  const entries: CompiledContextV1["context"]["entries"] = [
    {
      eventId: "e1",
      streamSeq: 1,
      role: "user",
      occurredAt: "2026-08-30T09:00:00.000Z",
      text: "看这张图",
      attachments: [
        {
          sourceRef: "ref-1",
          resolution: { status: "resolved", artifactId: "media-1", mimeType: "image/png" },
        },
      ],
    },
  ];

  const visionBuild = await buildCanonicalHistory(
    baseDeps({
      compileContext: () => Promise.resolve(compiledWith(entries)),
      artifactRevisionStore,
      contentSink,
      supportsImageInput: true,
    }),
  );
  const visionBlocks = (visionBuild.messages[0] as { content: Array<{ type: string }> }).content;
  assert.ok(visionBlocks.some((block) => block.type === MESSAGE_CONTENT_TYPE.IMAGE));

  // 同一段历史，非 vision 模型 → 占位符文本。
  const textOnlyBuild = await buildCanonicalHistory(
    baseDeps({
      compileContext: () => Promise.resolve(compiledWith(entries)),
      artifactRevisionStore,
      contentSink,
      supportsImageInput: false,
    }),
  );
  const textBlocks = (
    textOnlyBuild.messages[0] as { content: Array<{ type: string; text?: string }> }
  ).content;
  assert.ok(textBlocks.every((block) => block.type === MESSAGE_CONTENT_TYPE.TEXT));
});

test("sink read failure degrades the attachment to a placeholder instead of throwing", async () => {
  const entries: CompiledContextV1["context"]["entries"] = [
    {
      eventId: "e1",
      streamSeq: 1,
      role: "user",
      occurredAt: "2026-08-30T09:00:00.000Z",
      text: "图",
      attachments: [
        {
          sourceRef: "ref-1",
          resolution: { status: "resolved", artifactId: "media-1", mimeType: "image/png" },
        },
      ],
    },
  ];
  const build = await buildCanonicalHistory(
    baseDeps({
      compileContext: () => Promise.resolve(compiledWith(entries)),
      artifactRevisionStore: {
        async put() {
          throw new Error("no");
        },
        async getById() {
          return null;
        },
        async getByContent() {
          return null;
        },
      },
      contentSink: {
        async put() {
          throw new Error("no");
        },
        async get() {
          return null;
        },
      },
      supportsImageInput: true,
    }),
  );
  const blocks = (build.messages[0] as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(blocks.every((block) => block.type === MESSAGE_CONTENT_TYPE.TEXT));
});

function legacyTurn(): AgentMessage[] {
  return [
    {
      role: MESSAGE_ROLE.USER,
      content: [text("在吗")],
      timestamp: 1,
    },
    {
      role: MESSAGE_ROLE.ASSISTANT,
      content: [text("在的")],
      timestamp: 2,
    },
  ];
}

function canonicalTurn(): AgentMessage[] {
  return [
    {
      role: MESSAGE_ROLE.USER,
      content: [text("在吗")],
      timestamp: 1000,
    },
    {
      role: MESSAGE_ROLE.ASSISTANT,
      content: [text("在的")],
      timestamp: 2000,
    },
  ];
}

test("dual comparison: same projections → same regardless of timestamps", () => {
  const comparison = compareDualHistories(legacyTurn(), canonicalTurn());
  assert.equal(comparison.result, "same");
  assert.deepEqual(comparison.dimensions, []);
  assert.equal(canonicalMessagesHash(legacyTurn()), canonicalMessagesHash(canonicalTurn()));
});

test("dual comparison classifies role order, text mismatch, and missing media", () => {
  const differentRoles = compare(legacyTurn(), [
    {
      role: MESSAGE_ROLE.ASSISTANT,
      content: [text("在吗")],
      timestamp: 1,
    },
    {
      role: MESSAGE_ROLE.USER,
      content: [text("在的")],
      timestamp: 2,
    },
  ]);
  assert.equal(differentRoles.result, "different");
  assert.ok(differentRoles.dimensions.includes("role_order"));

  const textMismatch = compare(legacyTurn(), [
    legacyTurn()[0],
    { role: MESSAGE_ROLE.ASSISTANT, content: [text("不在")], timestamp: 2 },
  ]);
  assert.deepEqual(textMismatch.dimensions, ["text_mismatch"]);

  const missingMedia = compare(
    [
      {
        role: MESSAGE_ROLE.USER,
        content: [text("图"), { type: MESSAGE_CONTENT_TYPE.IMAGE, data: "x", mimeType: "image/png" }],
        timestamp: 1,
      },
    ],
    [{ role: MESSAGE_ROLE.USER, content: [text("图")], timestamp: 1 }],
  );
  assert.deepEqual(missingMedia.dimensions, ["media_missing"]);

  const entryCount = compare(legacyTurn(), [legacyTurn()[0]]);
  assert.deepEqual(entryCount.dimensions, ["entry_count"]);
});

test("compile failure surfaces as CanonicalContextBuildError(compile_failed)", async () => {
  const { CanonicalContextBuildError } = await import("../../src/engine/context-build/index.js");
  await assert.rejects(
    () =>
      buildCanonicalHistory(
        baseDeps({
          compileContext: () => Promise.reject(new Error("store down")),
        }),
      ),
    (error: unknown) => error instanceof CanonicalContextBuildError && error.code === "compile_failed",
  );
});
