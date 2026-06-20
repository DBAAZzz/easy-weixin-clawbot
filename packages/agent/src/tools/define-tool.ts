import { MESSAGE_CONTENT_TYPE } from "@clawbot/shared";
import { z } from "zod";
import { isToolContextMissingError } from "../runtime/agent-tool-context.js";
import type { ToolContent, ToolContext, ToolSnapshotItem } from "./types.js";

export function textResult(text: string): ToolContent[] {
  return [{ type: MESSAGE_CONTENT_TYPE.TEXT, text }];
}

/**
 * Defines a native tool whose handler receives schema-validated, inferred args.
 *
 * Invalid model arguments are converted to normal tool text results because
 * tool execution errors would otherwise abort the whole agent turn.
 */
export function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  parameters: S;
  execute: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolContent[]>;
}): ToolSnapshotItem {
  return {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    async execute(rawArgs, ctx) {
      const parsed = def.parameters.safeParse(rawArgs);
      if (!parsed.success) {
        return textResult(
          `❌ 参数错误：${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        );
      }

      try {
        return await def.execute(parsed.data, ctx);
      } catch (error) {
        if (isToolContextMissingError(error)) {
          return textResult("❌ 内部错误：缺少上下文信息");
        }
        throw error;
      }
    },
  };
}
