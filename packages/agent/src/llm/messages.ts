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
import {
  MESSAGE_CONTENT_TYPE,
  MESSAGE_ROLE,
  MESSAGE_STOP_REASON,
} from "@clawbot/shared";
import type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
  TriggerMessage,
  UserMessage,
} from "./types.js";
import { extractToolResultText } from "../shared/utils/chat-utils.js";

// ── AgentMessage[] → AI SDK ModelMessage[] ─────────────────────────

export const TEXT_ONLY_IMAGE_PLACEHOLDER =
  "[图片: 当前模型不支持图片输入，图片内容已省略。请直接说明无法查看图片，不要猜测图片内容。]";

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapFinishReason(finishReason: string): string {
  switch (finishReason) {
    case "stop": return MESSAGE_STOP_REASON.STOP;
    case "length": return "length";
    case "tool-calls": return MESSAGE_STOP_REASON.TOOL_USE;
    case "error": return "error";
    case "content-filter": return "error";
    default: return MESSAGE_STOP_REASON.STOP;
  }
}

export function mapModelResultToAssistantMessage(
  result: {
    content: unknown[];
    finishReason: string;
    usage: { inputTokens?: number; outputTokens?: number };
    response?: { modelId?: string };
  },
  fallbackModelId: string,
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  for (const part of result.content) {
    const p = part as {
      type: string;
      text?: string;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
      args?: unknown;
    };

    if (p.type === "text" && p.text) {
      content.push({ type: MESSAGE_CONTENT_TYPE.TEXT, text: p.text });
    } else if (p.type === "reasoning" && p.text) {
      content.push({ type: MESSAGE_CONTENT_TYPE.THINKING, thinking: p.text });
    } else if (p.type === "tool-call") {
      content.push({
        type: MESSAGE_CONTENT_TYPE.TOOL_CALL,
        id: p.toolCallId ?? "",
        name: p.toolName ?? "",
        arguments: normalizeToolArguments(p.input ?? p.args),
      });
    }
  }

  return {
    role: MESSAGE_ROLE.ASSISTANT,
    content,
    timestamp: Date.now(),
    model: result.response?.modelId ?? fallbackModelId,
    stopReason: mapFinishReason(result.finishReason),
    usage: {
      input: result.usage.inputTokens ?? 0,
      output: result.usage.outputTokens ?? 0,
    },
  };
}

function userToModel(msg: UserMessage): UserModelMessage {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }
  const parts = msg.content.map((block) => {
    if (block.type === MESSAGE_CONTENT_TYPE.TEXT) {
      return { type: "text" as const, text: block.text };
    }
    // ImageContent → ImagePart
    return { type: "image" as const, image: block.data, mimeType: block.mimeType };
  });
  return { role: "user", content: parts };
}

/** Prefix marking a turn as system-originated rather than user-spoken. */
export const TRIGGER_PROMPT_PREFIX = "[系统触发·提醒]";

/**
 * Trigger turns reach the model as user messages so role alternation stays
 * valid, but carry a prefix so the model does not later mistake them for
 * something the user actually said.
 */
function triggerToModel(msg: TriggerMessage): UserModelMessage {
  const text = msg.content.map((block) => block.text).join("\n");
  return { role: "user", content: `${TRIGGER_PROMPT_PREFIX} ${text}` };
}

function assistantToModel(msg: AssistantMessage): AssistantModelMessage {
  const parts = msg.content.map((block) => {
    if (block.type === MESSAGE_CONTENT_TYPE.TEXT) {
      return { type: "text" as const, text: block.text };
    }
    if (block.type === MESSAGE_CONTENT_TYPE.THINKING) {
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
    .filter((b): b is TextContent => b.type === MESSAGE_CONTENT_TYPE.TEXT)
    .map((b) => b.text)
    .join("\n");

  if (isError) {
    return { type: "error-text", value: text || "Tool execution failed" };
  }

  const hasImages = content.some((b) => b.type === MESSAGE_CONTENT_TYPE.IMAGE);
  if (!hasImages) {
    return { type: "text", value: text };
  }

  // Mixed content with images
  const parts = content.map((block) => {
    if (block.type === MESSAGE_CONTENT_TYPE.TEXT) {
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

type AssistantParts = Exclude<AssistantModelMessage["content"], string>;

function assistantParts(content: AssistantModelMessage["content"]): AssistantParts {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/**
 * Collapse adjacent assistant messages into one.
 *
 * Proactive pushes (heartbeat, scheduler, RSS) append assistant messages that
 * are not preceded by a user message, so stored history can hold consecutive
 * assistants. Anthropic requires strictly alternating roles and rejects that
 * shape, so merge them at the provider boundary.
 *
 * Assistant messages carrying tool calls are always separated by their tool
 * results, so they never end up adjacent here.
 */
function mergeAdjacentAssistants(messages: ModelMessage[]): ModelMessage[] {
  const merged: ModelMessage[] = [];

  for (const msg of messages) {
    const prev = merged[merged.length - 1];

    if (msg.role !== "assistant" || prev?.role !== "assistant") {
      merged.push(msg);
      continue;
    }

    merged[merged.length - 1] = {
      role: "assistant",
      content: [...assistantParts(prev.content), ...assistantParts(msg.content)],
    } satisfies AssistantModelMessage;
  }

  return merged;
}

/**
 * Convert project-internal AgentMessage[] to AI SDK ModelMessage[].
 * Groups consecutive toolResult messages into a single ToolModelMessage,
 * and merges adjacent assistant messages (see mergeAdjacentAssistants).
 */
export function agentToModelMessages(messages: AgentMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === MESSAGE_ROLE.TOOL_RESULT) {
      // Group consecutive toolResult messages into one ToolModelMessage
      const toolResults: ToolResultPart[] = [];
      while (i < messages.length && messages[i].role === MESSAGE_ROLE.TOOL_RESULT) {
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
    } else if (msg.role === MESSAGE_ROLE.USER) {
      result.push(userToModel(msg));
      i++;
    } else if (msg.role === MESSAGE_ROLE.TRIGGER) {
      result.push(triggerToModel(msg));
      i++;
    } else {
      result.push(assistantToModel(msg));
      i++;
    }
  }

  return mergeAdjacentAssistants(result);
}

/**
 * Characters of a tool result carried into narration text. Beyond this the tail
 * is dropped: narrated output is prose inside an assistant turn, and a very long
 * one reads as a wall of serialized data rather than a record of what happened.
 */
const NARRATED_TOOL_RESULT_MAX_CHARS = 2000;

/**
 * Render one tool round-trip as narration text.
 *
 * A missing result is stated rather than omitted — it means the call never came
 * back (aborted run, dropped result), which the model should see as a fact about
 * the conversation instead of inferring from a silent gap.
 */
function narrateToolCall(
  call: ToolCallContent,
  result: ToolResultMessage | undefined,
): TextContent {
  const args = JSON.stringify(call.arguments ?? {});
  const head = `[已调用工具 ${call.name}(${args})`;

  if (!result) {
    return { type: MESSAGE_CONTENT_TYPE.TEXT, text: `${head}，未返回结果]` };
  }

  const raw = extractToolResultText(result);
  const output =
    raw.length > NARRATED_TOOL_RESULT_MAX_CHARS
      ? `${raw.slice(0, NARRATED_TOOL_RESULT_MAX_CHARS)}…（结果已截断）`
      : raw;

  return {
    type: MESSAGE_CONTENT_TYPE.TEXT,
    text: `${head}，${result.isError ? "返回错误" : "返回"}：${output}]`,
  };
}

/**
 * Flatten tool round-trips that carry no reasoning into plain narration text.
 *
 * DeepSeek v4 thinking mode rejects historical assistant tool calls without
 * reasoning_content. History reaches that shape whenever a conversation ran on a
 * non-thinking model first — a routine result of switching a conversation's model,
 * not just legacy data — so this has to stay correct for histories that keep
 * growing, not merely tolerate old rows.
 *
 * Narrating rather than deleting is deliberate. Dropping the call leaves the
 * assistant's own "let me look that up" with no visible outcome, and a model that
 * cannot see its prior call simply makes it again — which strips again next
 * round, looping until maxRounds. Narration keeps the record, and plain text is
 * accepted by every provider, so it needs no per-provider wire-format guesswork.
 */
export function narrateUnreasonedToolCalls(messages: AgentMessage[]): AgentMessage[] {
  // Indexed up front: a result is not guaranteed to sit adjacent to its call.
  const resultsByCallId = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === MESSAGE_ROLE.TOOL_RESULT && !resultsByCallId.has(msg.toolCallId)) {
      resultsByCallId.set(msg.toolCallId, msg);
    }
  }

  const narratedCallIds = new Set<string>();
  const result: AgentMessage[] = [];

  for (const msg of messages) {
    if (msg.role === MESSAGE_ROLE.ASSISTANT) {
      const hasToolCall = msg.content.some((block) => block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL);
      const hasThinking = msg.content.some(
        (block) => block.type === MESSAGE_CONTENT_TYPE.THINKING && block.thinking.trim().length > 0,
      );

      if (hasToolCall && !hasThinking) {
        const content = msg.content.flatMap((block) => {
          if (block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL) {
            narratedCallIds.add(block.id);
            return [narrateToolCall(block, resultsByCallId.get(block.id))];
          }
          // Only blank thinking blocks can reach here (a non-blank one would have
          // skipped this branch), and an empty reasoning part is the very thing
          // the target model objects to. Drop them.
          if (block.type === MESSAGE_CONTENT_TYPE.THINKING) {
            return [];
          }
          return [block];
        });

        result.push({ ...msg, content });
        continue;
      }
    }

    if (msg.role === MESSAGE_ROLE.TOOL_RESULT && narratedCallIds.has(msg.toolCallId)) {
      continue;
    }

    result.push(msg);
  }

  return result;
}

function replaceImageBlock(block: TextContent | ImageContent): TextContent {
  if (block.type === MESSAGE_CONTENT_TYPE.TEXT) {
    return block;
  }
  return { type: MESSAGE_CONTENT_TYPE.TEXT, text: block.promptReplacementText ?? TEXT_ONLY_IMAGE_PLACEHOLDER };
}

/**
 * Text-only providers such as the current DeepSeek chat API reject OpenAI-style
 * image_url parts. Preserve conversation text while replacing images with an
 * explicit placeholder before converting to provider messages.
 */
export function replaceImagesWithTextPlaceholders(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg) => {
    if (msg.role === MESSAGE_ROLE.USER) {
      if (typeof msg.content === "string") {
        return msg;
      }
      if (!msg.content.some((block) => block.type === MESSAGE_CONTENT_TYPE.IMAGE)) {
        return msg;
      }
      return { ...msg, content: msg.content.map(replaceImageBlock) };
    }

    if (msg.role === MESSAGE_ROLE.TOOL_RESULT) {
      if (!msg.content.some((block) => block.type === MESSAGE_CONTENT_TYPE.IMAGE)) {
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

  if (role === MESSAGE_ROLE.USER) {
    return {
      role: MESSAGE_ROLE.USER,
      content: payload.content as UserMessage["content"],
      timestamp,
      visualContext: payload.visualContext as UserMessage["visualContext"],
    };
  }

  if (role === MESSAGE_ROLE.ASSISTANT) {
    const rawContent = payload.content as any[];
    const content = rawContent?.map((block: any) => {
      if (block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL) {
        return {
          type: MESSAGE_CONTENT_TYPE.TOOL_CALL,
          id: String(block.id ?? block.toolCallId ?? ""),
          name: String(block.name ?? block.toolName ?? ""),
          arguments: normalizeToolArguments(block.arguments ?? block.input ?? block.args),
        };
      }
      if (block.type === MESSAGE_CONTENT_TYPE.THINKING) {
        return {
          type: MESSAGE_CONTENT_TYPE.THINKING,
          thinking: block.thinking,
        };
      }
      return { type: MESSAGE_CONTENT_TYPE.TEXT, text: block.text ?? "" };
    }) ?? [];

    return {
      role: MESSAGE_ROLE.ASSISTANT,
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
    role: MESSAGE_ROLE.TOOL_RESULT,
    toolCallId: (payload.toolCallId as string) ?? "",
    toolName: (payload.toolName as string) ?? "",
    content: (payload.content as ToolResultMessage["content"]) ?? [],
    isError: (payload.isError as boolean) ?? false,
    timestamp,
  };
}
