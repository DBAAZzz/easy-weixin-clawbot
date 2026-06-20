import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createToolContextSlot } from "../runtime/agent-tool-context.js";
import { defineTool } from "./define-tool.js";

const abortSignal = new AbortController().signal;

test("defineTool passes schema-inferred parsed args to the handler", async () => {
  const tool = defineTool({
    name: "demo",
    description: "demo",
    parameters: z.object({
      value: z.number(),
    }),
    async execute(args) {
      return [{ type: "text", text: String(args.value + 1) }];
    },
  });

  const result = await tool.execute({ value: 41 }, { signal: abortSignal });

  assert.deepEqual(result, [{ type: "text", text: "42" }]);
});

test("defineTool converts invalid args to a text result", async () => {
  const tool = defineTool({
    name: "demo",
    description: "demo",
    parameters: z.object({
      value: z.number(),
    }),
    async execute() {
      throw new Error("handler should not run");
    },
  });

  const result = await tool.execute({ value: "bad" }, { signal: abortSignal });

  assert.equal(result[0]?.type, "text");
  assert.match(result[0]?.text ?? "", /^❌ 参数错误：/);
});

test("defineTool converts missing tool context to the legacy text result", async () => {
  const slot = createToolContextSlot();
  const tool = defineTool({
    name: "demo",
    description: "demo",
    parameters: z.object({}),
    async execute() {
      slot.require();
      return [{ type: "text", text: "unreachable" }];
    },
  });

  const result = await tool.execute({}, { signal: abortSignal });

  assert.deepEqual(result, [{ type: "text", text: "❌ 内部错误：缺少上下文信息" }]);
});
