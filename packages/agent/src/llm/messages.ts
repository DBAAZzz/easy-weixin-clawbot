/**
 * Message conversion utilities.
 *
 * - AgentMessage[] → AI SDK ModelMessage[] (for generateText)
 * - Legacy pi-ai DB payload → AgentMessage   (for "读旧写新")
 */

import type {
  ModelMessage,
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
  ToolResultPart,
} from "ai";
import type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "./types.js";

// ── AgentMessage[] → AI SDK ModelMessage[] ─────────────────────────

export const TEXT_ONLY_IMAGE_PLACEHOLDER =
  "[图片: 当前模型不支持图片输入，图片内容已省略。请直接说明无法查看图片，不要猜测图片内容。]";

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function userToModel(msg: UserMessage): UserModelMessage {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }
  const parts = msg.content.map((block) => {
    if (block.type === "text") {
      return { type: "text" as const, text: block.text };
    }
    // ImageContent → ImagePart
    return { type: "image" as const, image: block.data, mimeType: block.mimeType };
  });
  return { role: "user", content: parts };
}

function assistantToModel(msg: AssistantMessage): AssistantModelMessage {
  const parts = msg.content.map((block) => {
    if (block.type === "text") {
      return { type: "text" as const, text: block.text };
    }
    if (block.type === "thinking") {
      return { type: "reasoning" as const, text: block.thinking } as any;
    }
    // toolCall
    return {
      type: "tool-call" as const,
      toolCallId: block.id,
      toolName: block.name,
      input: normalizeToolArguments(block.arguments),
    };
  });
  return { role: "assistant", content: parts };
}

function toolContentToOutput(
  content: (TextContent | ImageContent)[],
  isError: boolean,
): ToolResultPart["output"] {
  const text = content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  if (isError) {
    return { type: "error-text", value: text || "Tool execution failed" };
  }

  const hasImages = content.some((b) => b.type === "image");
  if (!hasImages) {
    return { type: "text", value: text };
  }

  // Mixed content with images
  const parts = content.map((block) => {
    if (block.type === "text") {
      return { type: "text" as const, text: block.text };
    }
    return {
      type: "image-data" as const,
      data: block.data,
      mediaType: block.mimeType,
    };
  });
  return { type: "content", value: parts };
}

/**
 * Convert project-internal AgentMessage[] to AI SDK ModelMessage[].
 * Groups consecutive toolResult messages into a single ToolModelMessage.
 */
export function agentToModelMessages(messages: AgentMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "toolResult") {
      // Group consecutive toolResult messages into one ToolModelMessage
      const toolResults: ToolResultPart[] = [];
      while (i < messages.length && messages[i].role === "toolResult") {
        const tr = messages[i] as ToolResultMessage;
        toolResults.push({
          type: "tool-result",
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: toolContentToOutput(tr.content, tr.isError),
        });
        i++;
      }
      result.push({ role: "tool", content: toolResults } as ToolModelMessage);
    } else if (msg.role === "user") {
      result.push(userToModel(msg));
      i++;
    } else {
      result.push(assistantToModel(msg));
      i++;
    }
  }

  return result;
}

/**
 * DeepSeek v4 thinking mode rejects historical assistant tool calls that do not
 * include reasoning_content. Older non-thinking DeepSeek conversations can have
 * exactly that shape, so remove only the stale tool-call linkage before sending.
 */
export function stripUnreasonedToolCallHistory(messages: AgentMessage[]): AgentMessage[] {
  const strippedToolCallIds = new Set<string>();
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const hasToolCall = msg.content.some((block) => block.type === "toolCall");
      const hasThinking = msg.content.some(
        (block) => block.type === "thinking" && block.thinking.trim().length > 0,
      );

      if (hasToolCall && !hasThinking) {
        const content = msg.content.filter((block) => {
          if (block.type !== "toolCall") {
            return true;
          }
          strippedToolCallIds.add(block.id);
          return false;
        });

        if (content.length > 0) {
          result.push({ ...msg, content });
        }
        continue;
      }
    }

    if (msg.role === "toolResult" && strippedToolCallIds.has(msg.toolCallId)) {
      continue;
    }

    result.push(msg);
  }

  return result;
}

function replaceImageBlock(block: TextContent | ImageContent): TextContent {
  if (block.type === "text") {
    return block;
  }
  return { type: "text", text: TEXT_ONLY_IMAGE_PLACEHOLDER };
}

/**
 * Text-only providers such as the current DeepSeek chat API reject OpenAI-style
 * image_url parts. Preserve conversation text while replacing images with an
 * explicit placeholder before converting to provider messages.
 */
export function replaceImagesWithTextPlaceholders(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        return msg;
      }
      if (!msg.content.some((block) => block.type === "image")) {
        return msg;
      }
      return { ...msg, content: msg.content.map(replaceImageBlock) };
    }

    if (msg.role === "toolResult") {
      if (!msg.content.some((block) => block.type === "image")) {
        return msg;
      }
      return { ...msg, content: msg.content.map(replaceImageBlock) };
    }

    return msg;
  });
}

// ── Legacy pi-ai payload → AgentMessage ("读旧写新") ───────────────

/**
 * Convert a legacy pi-ai Message JSON payload from the DB into an AgentMessage.
 * Handles both old pi-ai format and new format transparently.
 */
export function legacyPayloadToAgentMessage(payload: Record<string, unknown>): AgentMessage {
  const role = payload.role as string;
  const timestamp = (payload.timestamp as number) ?? Date.now();

  if (role === "user") {
    return {
      role: "user",
      content: payload.content as UserMessage["content"],
      timestamp,
    };
  }

  if (role === "assistant") {
    const rawContent = payload.content as any[];
    const content = rawContent?.map((block: any) => {
      if (block.type === "toolCall") {
        return {
          type: "toolCall" as const,
          id: String(block.id ?? block.toolCallId ?? ""),
          name: String(block.name ?? block.toolName ?? ""),
          arguments: normalizeToolArguments(block.arguments ?? block.input ?? block.args),
        };
      }
      if (block.type === "thinking") {
        return {
          type: "thinking" as const,
          thinking: block.thinking,
        };
      }
      return { type: "text" as const, text: block.text ?? "" };
    }) ?? [];

    return {
      role: "assistant",
      content,
      timestamp,
      model: payload.model as string | undefined,
      provider: payload.provider as string | undefined,
      stopReason: payload.stopReason as string | undefined,
      errorMessage: payload.errorMessage as string | undefined,
      usage: payload.usage as { input: number; output: number } | undefined,
    };
  }

  // toolResult (legacy role name is also "toolResult")
  return {
    role: "toolResult",
    toolCallId: (payload.toolCallId as string) ?? "",
    toolName: (payload.toolName as string) ?? "",
    content: (payload.content as ToolResultMessage["content"]) ?? [],
    isError: (payload.isError as boolean) ?? false,
    timestamp,
  };
}
