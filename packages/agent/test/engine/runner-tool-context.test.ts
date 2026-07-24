/**
 * Regression tests for the ToolContext the runner hands to each tool call.
 *
 * The tool's signal must always be the per-call one (tool timeout composed with
 * the run signal). An earlier version built it by spreading RunContext over it,
 * which let RunContext.signal — present-but-undefined on chat/heartbeat runs —
 * clobber the timeout and silently disable it.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { createAgentRunner } from "../../src/engine/runner.js";
import type { RunContext } from "../../src/engine/context.js";
import type { AgentMessage } from "../../src/llm/types.js";
import { createSkillRegistry } from "../../src/capabilities/skills/registry.js";
import type {
  ToolContext,
  ToolRegistry,
  ToolSnapshot,
} from "../../src/capabilities/tools/types.js";
import { loadPromptAssets, setPromptAssets } from "../../src/prompts/index.js";

setPromptAssets(loadPromptAssets());

const MODEL_META = {
  contextWindow: 128_000,
  maxOutputTokens: 4_096,
  supportsVision: false,
} as const;

function usage() {
  return {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  };
}

/** A model that calls `probe` once, then replies with plain text. */
function createToolCallingModel(): MockLanguageModelV3 {
  let round = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      round += 1;
      if (round === 1) {
        return {
          content: [
            { type: "tool-call" as const, toolCallId: "call-1", toolName: "probe", input: "{}" },
          ],
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: usage(),
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(),
        warnings: [],
      };
    },
  });
}

/** Tool registry with a single `probe` tool that records the ctx it receives. */
function createProbeRegistry(): { registry: ToolRegistry; seen: ToolContext[] } {
  const seen: ToolContext[] = [];
  const snapshot: ToolSnapshot = {
    tools: [
      {
        name: "probe",
        description: "records the tool context it was invoked with",
        parameters: z.object({}),
        async execute(_args, ctx) {
          seen.push(ctx);
          return [{ type: "text" as const, text: "ok" }];
        },
      },
    ],
  };

  return {
    seen,
    registry: {
      swap() {},
      current: () => snapshot,
      execute(name, args, ctx) {
        const tool = snapshot.tools.find((t) => t.name === name);
        if (!tool) throw new Error(`unknown tool ${name}`);
        return tool.execute(args, ctx);
      },
    },
  };
}

async function runWith(ctx: RunContext, signal?: AbortSignal): Promise<ToolContext> {
  const { registry, seen } = createProbeRegistry();
  const runner = createAgentRunner(
    { systemPrompt: "test", toolTimeoutMs: 30_000 },
    registry,
    createSkillRegistry(),
  );

  const history: AgentMessage[] = [
    { role: "user", content: [{ type: "text", text: "hi" }], timestamp: Date.now() },
  ];

  const result = await runner.run(
    history,
    { onMessage() {} },
    signal,
    { model: createToolCallingModel(), meta: MODEL_META },
    ctx,
  );

  assert.equal(result.status, "completed");
  assert.equal(seen.length, 1, "probe tool should have been called exactly once");
  return seen[0]!;
}

test("tool receives a live signal even when RunContext.signal is explicitly undefined", async () => {
  // The heartbeat shape: ChatExecutorPort's impl always sets `signal`, so the
  // key is present with an undefined value — the case that used to wipe out the
  // tool timeout entirely.
  const ctx: RunContext = {
    accountId: "acc-1",
    conversationId: "conv-1",
    runKind: "heartbeat",
    signal: undefined,
  };

  const toolCtx = await runWith(ctx);

  assert.ok(toolCtx.signal, "tool ctx must carry a signal, not undefined");
  assert.equal(typeof toolCtx.signal.aborted, "boolean");
});

test("tool signal is the per-call composed one, never the run signal itself", async () => {
  const runController = new AbortController();
  const ctx: RunContext = {
    accountId: "acc-2",
    conversationId: "conv-2",
    runKind: "scheduler",
    signal: runController.signal,
  };

  const toolCtx = await runWith(ctx, runController.signal);

  assert.notEqual(
    toolCtx.signal,
    runController.signal,
    "tool must get timeout-composed signal, not the raw run signal",
  );
  assert.equal(toolCtx.signal.aborted, false);
});

test("run identity fields reach the tool and nothing else leaks into ToolContext", async () => {
  const ctx: RunContext = {
    accountId: "acc-3",
    conversationId: "scheduler:7",
    targetConversationId: "wxid_real_conversation",
    runKind: "scheduler",
    logger: { info() {}, warn() {}, error() {}, debug() {} } as unknown as RunContext["logger"],
  };

  const toolCtx = await runWith(ctx);

  assert.equal(toolCtx.accountId, "acc-3");
  assert.equal(toolCtx.conversationId, "scheduler:7");
  // Scheduler runs stay addressable to the conversation that owns the task.
  assert.equal(toolCtx.targetConversationId, "wxid_real_conversation");
  assert.equal(toolCtx.runKind, "scheduler");
  assert.deepEqual(
    Object.keys(toolCtx).sort(),
    ["accountId", "conversationId", "runKind", "signal", "targetConversationId"],
    "RunContext-only fields (logger, signal source) must not leak into ToolContext",
  );
});
