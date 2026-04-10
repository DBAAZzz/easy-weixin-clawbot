/**
 * Project-internal message and model types.
 *
 * These types decouple the codebase from any specific LLM SDK.
 * Conversion to/from AI SDK ModelMessage happens at the boundary (llm/messages.ts).
 */

export type { LanguageModel } from "ai";

// ── Content blocks ─────────────────────────────────────────────────

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// ── Messages ───────────────────────────────────────────────────────

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCallContent)[];
  timestamp: number;
  /** Metadata populated by the runner from GenerateTextResult */
  model?: string;
  provider?: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input: number; output: number };
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

// ── Model metadata (sidecar for LanguageModel) ─────────────────────

export interface ModelMeta {
  contextWindow: number;
  maxOutputTokens: number;
}
