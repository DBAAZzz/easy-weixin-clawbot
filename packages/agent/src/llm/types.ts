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
  promptReplacementText?: string;
}

export interface VisualContext {
  provider: "vision";
  modelId: string;
  generatedAt: string;
  summary: string;
  ocrText: string[];
  objects: string[];
  scene?: string;
  possibleIntent?: string;
  confidence?: number;
  limitations?: string[];
  fallbackReason?: VisionFallbackReason;
}

export type VisionFallbackReason =
  | "chat_model_no_vision"
  | "chat_model_vision_unknown"
  | "no_vision_model_configured"
  | "vision_call_failed"
  | "vision_call_timeout"
  | "vision_empty_result"
  | "vision_parse_failed"
  | "image_limit_exceeded";

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
  visualContext?: VisualContext[];
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
  /**
   * true means the model can receive image content directly.
   * false or undefined means image content must not be sent directly.
   */
  supportsImageInput?: boolean;
}
