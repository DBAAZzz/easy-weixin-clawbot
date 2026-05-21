import type {
  AssistantMessage,
  ModelMeta,
  TextContent,
  ToolResultMessage,
  VisionFallbackReason,
} from "../llm/types.js";

export function detectImageMime(buf: Buffer): string | null {
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  if (buf[0] === 0x42 && buf[1] === 0x4D) return "image/bmp";
  return null;
}

export function extractTextContent(blocks: readonly { type: string }[]): string {
  return blocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function extractAssistantText(message: AssistantMessage): string {
  return extractTextContent(message.content);
}

export function extractToolResultText(message: ToolResultMessage): string {
  return extractTextContent(message.content) || "[non-text tool result]";
}

export function isEmptyAssistantMessage(message: { role: string; content: unknown }): boolean {
  return (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.length === 0
  );
}

export function getChatModelVisionFallbackReason(meta: ModelMeta): VisionFallbackReason {
  return meta.supportsImageInput === false ? "chat_model_no_vision" : "chat_model_vision_unknown";
}

export function getVisionFailureReason(error: unknown): VisionFallbackReason {
  if (error instanceof Error && error.message === "vision_empty_result") return "vision_empty_result";
  if (error instanceof Error && error.name === "TimeoutError") return "vision_call_timeout";
  return "vision_call_failed";
}
