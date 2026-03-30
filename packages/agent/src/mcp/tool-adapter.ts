import type { TSchema } from "@mariozechner/pi-ai";
import type { ToolContext, ToolSnapshotItem } from "../tools/types.js";
import type { McpToolBinding, StdioMcpClient } from "./types.js";

function stringifyToolError(
  binding: Pick<McpToolBinding, "remote_name">,
  content: Awaited<ReturnType<StdioMcpClient["callTool"]>>["content"],
): string {
  const text = content
    .map((block) => ("text" in block ? block.text : "[image]"))
    .join("\n")
    .trim();

  return text || `MCP tool failed: ${binding.remote_name}`;
}

export function createMcpToolSnapshotItem(
  binding: Pick<
    McpToolBinding,
    "remote_name" | "local_name" | "summary" | "server_name" | "input_schema"
  >,
  client: StdioMcpClient,
): ToolSnapshotItem {
  return {
    name: binding.local_name,
    description:
      binding.summary?.trim() ||
      `MCP tool ${binding.remote_name} from ${binding.server_name}`,
    parameters: binding.input_schema as TSchema,
    async execute(args: Record<string, unknown>, ctx: ToolContext) {
      const result = await client.callTool(binding.remote_name, args, ctx.signal);
      if (result.isError) {
        throw new Error(stringifyToolError(binding, result.content));
      }
      return result.content;
    },
  };
}
