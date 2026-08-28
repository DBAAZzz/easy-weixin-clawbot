import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { createSkillRegistry } from "../../src/capabilities/skills/registry.js";
import { createToolRegistry } from "../../src/capabilities/tools/registry.js";
import type { ToolSnapshot } from "../../src/capabilities/tools/types.js";
import { createChatEngine, type ChatEngine, type ChatLog } from "../../src/engine/chat-engine.js";
import type { RunContext } from "../../src/engine/context.js";
import {
  createAgentRunner,
  type AgentRunner,
  type ModelOverride,
} from "../../src/engine/runner.js";
import type { AgentMessage, AssistantMessage } from "../../src/llm/types.js";
import { invalidateModelCache } from "../../src/llm/model-resolver.js";
import {
  setMessageStore,
  setModelConfigStore,
  setTapeStore,
  setUsageStore,
  type MessageStore,
  type ModelConfigRow,
  type ModelConfigStore,
  type ModelScope,
  type PersistMessageParams,
  type TapeStore,
} from "../../src/ports/index.js";

const noopLog: ChatLog = {
  llm() {},
  tool() {},
  done() {},
};

function baseContext(): RunContext {
  return { accountId: "account-1", conversationId: "conversation-1", runKind: "chat" };
}

function chatLocked(
  engine: ChatEngine,
  input: Parameters<ChatEngine["chat"]>[1],
): ReturnType<ChatEngine["chat"]> {
  const ctx = baseContext();
  return engine.conversations.withLock(ctx.accountId, ctx.conversationId, () =>
    engine.chat(ctx, input),
  );
}

function createDurableMessageStore(): MessageStore & { persisted: PersistMessageParams[] } {
  const persisted: PersistMessageParams[] = [];

  return {
    persisted,
    async restoreHistory(accountId, conversationId) {
      const rows = persisted
        .filter((item) => item.accountId === accountId && item.conversationId === conversationId)
        .sort((a, b) => a.seq - b.seq);
      return {
        messages: structuredClone(rows.map((item) => item.message)),
        maxSeq: rows.at(-1)?.seq ?? 0,
      };
    },
    queuePersistMessage(params) {
      persisted.push(structuredClone(params));
    },
    async rollbackMessages(accountId, conversationId, count) {
      const matching = persisted
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) => item.accountId === accountId && item.conversationId === conversationId,
        )
        .sort((a, b) => b.item.seq - a.item.seq)
        .slice(0, count)
        .map(({ index }) => index)
        .sort((a, b) => b - a);
      for (const index of matching) persisted.splice(index, 1);
    },
    async clearMessages(accountId, conversationId) {
      for (let index = persisted.length - 1; index >= 0; index -= 1) {
        const item = persisted[index];
        if (item?.accountId === accountId && item.conversationId === conversationId) {
          persisted.splice(index, 1);
        }
      }
    },
  };
}

function createTapeStore(options?: { rememberedPreference?: string }): TapeStore {
  const preference = options?.rememberedPreference;
  return {
    async createEntry() {
      return "entry-created";
    },
    async findEntries(_accountId, branch) {
      if (!preference || branch !== "__global__") return [];
      return [
        {
          eid: "memory-entry-1",
          branch,
          category: "preference",
          payload: {
            fragments: [{ kind: "text", data: { key: "preferred_drink", value: preference } }],
          },
          createdAt: new Date("2026-08-27T00:00:00.000Z"),
        },
      ];
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
    async createAnchor() {
      return "anchor-created";
    },
    async markCompacted() {},
    async compactTransaction() {},
    async purgeCompacted() {
      return 0;
    },
  };
}

function modelRow(
  modelId: string,
  vision: "default" | "supported" | "unsupported",
): ModelConfigRow {
  return {
    id: 1n,
    scope: "global",
    scopeKey: "*",
    purpose: "chat",
    templateId: 1n,
    templateName: "test-template",
    provider: "openai",
    modelId,
    modelIds: [modelId],
    apiKey: "test-key",
    baseUrl: null,
    supportsImageInputOverride: vision,
    templateEnabled: true,
    enabled: true,
    priority: 0,
  };
}

function createMutableModelStore(
  initialModelId: string,
  vision: "default" | "supported" | "unsupported" = "default",
) {
  let currentModelId = initialModelId;
  let currentVision: "default" | "supported" | "unsupported" = vision;

  async function unsupported(): Promise<never> {
    throw new Error("not used by this business scenario");
  }

  const store: ModelConfigStore = {
    async findByScope(scope: ModelScope, scopeKey: string) {
      return scope === "global" && scopeKey === "*"
        ? [modelRow(currentModelId, currentVision)]
        : [];
    },
    listTemplates: unsupported,
    createTemplate: unsupported,
    updateTemplate: unsupported,
    deleteTemplate: unsupported,
    getTemplateById: unsupported,
    countConfigsForTemplate: unsupported,
    listAllConfigs: unsupported,
    upsertConfig: unsupported,
    deleteConfig: unsupported,
  };

  return {
    store,
    get modelId() {
      return currentModelId;
    },
    switchTo(modelId: string) {
      currentModelId = modelId;
      invalidateModelCache();
    },
    setVision(value: "default" | "supported" | "unsupported") {
      currentVision = value;
      invalidateModelCache();
    },
  };
}

function assistantText(text: string, model: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
    model,
    provider: "test",
    stopReason: "stop",
  };
}

function textOf(message: AgentMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

test.beforeEach(() => {
  invalidateModelCache();
  setUsageStore({ queueRecord() {} });
});

test("当前聊天会把记忆和当前时间连同用户原文一起保存并交给模型", async () => {
  const messageStore = createDurableMessageStore();
  const modelStore = createMutableModelStore("chat-model-a");
  const historiesSeenByModel: AgentMessage[][] = [];
  const runner: AgentRunner = {
    async run(messages, callbacks) {
      historiesSeenByModel.push(structuredClone(messages));
      const reply = assistantText("ok", modelStore.modelId);
      callbacks.onMessage(reply);
      return { status: "completed", finalMessage: reply };
    },
  };

  setMessageStore(messageStore);
  setModelConfigStore(modelStore.store);
  setTapeStore(createTapeStore({ rememberedPreference: "tea" }));

  const reply = await chatLocked(createChatEngine({ runner, log: noopLog }), { text: "hi" });

  assert.equal(reply.text, "ok");
  const modelInput = textOf(historiesSeenByModel[0]![0]!);
  const storedInput = textOf(messageStore.persisted[0]!.message);
  assert.match(modelInput, /^\[当前时间:/);
  assert.match(modelInput, /<memory>/);
  assert.match(modelInput, /preferred_drink: "tea"/);
  assert.match(modelInput, /hi$/);
  assert.equal(storedInput, modelInput);
});

test("冷启动并切换模型后，新模型仍会收到旧模型形态的历史 transcript", async () => {
  const messageStore = createDurableMessageStore();
  const modelStore = createMutableModelStore("chat-model-old");
  const calls: Array<{ modelId: string; messages: AgentMessage[] }> = [];
  const runner: AgentRunner = {
    async run(messages, callbacks, _signal, override?: ModelOverride) {
      const modelId = String(
        (override?.model as unknown as { modelId?: string } | undefined)?.modelId ??
          modelStore.modelId,
      );
      calls.push({ modelId, messages: structuredClone(messages) });
      const reply = assistantText(calls.length === 1 ? "旧" : "新", modelId);
      callbacks.onMessage(reply);
      return { status: "completed", finalMessage: reply };
    },
  };

  setMessageStore(messageStore);
  setModelConfigStore(modelStore.store);
  setTapeStore(createTapeStore());

  await chatLocked(createChatEngine({ runner, log: noopLog }), { text: "一" });
  const firstStoredTurn = structuredClone(messageStore.persisted);

  modelStore.switchTo("chat-model-new");
  await chatLocked(createChatEngine({ runner, log: noopLog }), { text: "二" });

  assert.equal(calls[0]?.modelId, "chat-model-old");
  assert.equal(calls[1]?.modelId, "chat-model-new");
  const historySeenByNewModel = calls[1]!.messages;
  assert.equal(historySeenByNewModel[1]?.role, "assistant");
  assert.equal((historySeenByNewModel[1] as AssistantMessage).model, "chat-model-old");
  assert.match(textOf(historySeenByNewModel[0]!), /^\[当前时间:/);
  assert.deepEqual(messageStore.persisted.slice(0, 2), firstStoredTurn);
});

test("聊天模型不能看图且未配置视觉模型时，fallback 文本会进入永久消息历史", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "clawbot-phase0-vision-"));
  const imagePath = join(tempDir, "image.png");
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  try {
    const messageStore = createDurableMessageStore();
    const modelStore = createMutableModelStore("text-only-model", "unsupported");
    const historiesSeenByModel: AgentMessage[][] = [];
    const runner: AgentRunner = {
      async run(messages, callbacks) {
        historiesSeenByModel.push(structuredClone(messages));
        const reply = assistantText("ok", modelStore.modelId);
        callbacks.onMessage(reply);
        return { status: "completed", finalMessage: reply };
      },
    };

    setMessageStore(messageStore);
    setModelConfigStore(modelStore.store);
    setTapeStore(createTapeStore());

    await chatLocked(createChatEngine({ runner, log: noopLog }), {
      text: "图",
      media: {
        type: "image",
        filePath: imagePath,
        mimeType: "image/png",
        assetId: "asset-image-1",
      },
    });

    const userMessage = historiesSeenByModel[0]![0]!;
    const persistedUserMessage = messageStore.persisted[0]!.message;
    assert.match(textOf(userMessage), /未配置可用的 vision 模型/);
    assert.match(textOf(persistedUserMessage), /未配置可用的 vision 模型/);
    assert.equal(Array.isArray(persistedUserMessage.content), true);
    const image = Array.isArray(persistedUserMessage.content)
      ? persistedUserMessage.content.find((block) => block.type === "image")
      : undefined;
    assert.equal(image?.assetId, "asset-image-1");
    assert.equal(image?.promptReplacementText, "[图片原始文件已保存；未配置 vision 模型。]");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
}

test("一次工具任务会形成用户请求、工具调用、工具结果和最终回答的完整时间线", async () => {
  let modelRound = 0;
  let toolExecutions = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      modelRound += 1;
      if (modelRound === 1) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "call-weather-1",
              toolName: "get_weather",
              input: JSON.stringify({ city: "上海" }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: usage(),
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: "上海今天晴。" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: usage(),
        warnings: [],
      };
    },
  });
  const tools: ToolSnapshot = {
    tools: [
      {
        name: "get_weather",
        description: "查询城市天气",
        parameters: z.object({ city: z.string() }),
        async execute(args) {
          toolExecutions += 1;
          assert.deepEqual(args, { city: "上海" });
          return [{ type: "text", text: "晴，26°C" }];
        },
      },
    ],
  };
  const emitted: AgentMessage[] = [];
  const runner = createAgentRunner(
    { systemPrompt: "你是天气助手" },
    createToolRegistry(tools),
    createSkillRegistry(),
  );

  const result = await runner.run(
    [{ role: "user", content: [{ type: "text", text: "上海天气" }], timestamp: Date.now() }],
    {
      onMessage(message) {
        emitted.push(message);
      },
    },
    undefined,
    {
      model,
      meta: { contextWindow: 128_000, maxOutputTokens: 4_096 },
    },
    baseContext(),
  );

  assert.equal(result.status, "completed");
  assert.equal(toolExecutions, 1);
  assert.equal(modelRound, 2);
  assert.deepEqual(
    emitted.map((message) => message.role),
    ["assistant", "toolResult", "assistant"],
  );
  assert.equal(textOf(emitted[1]!), "晴，26°C");
  assert.equal(textOf(emitted[2]!), "上海今天晴。");
});
