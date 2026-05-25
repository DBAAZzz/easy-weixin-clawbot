export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL_RESULT: "toolResult",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export const MESSAGE_CONTENT_TYPE = {
  TEXT: "text",
  IMAGE: "image",
  THINKING: "thinking",
  TOOL_CALL: "toolCall",
} as const;

export type MessageContentType =
  (typeof MESSAGE_CONTENT_TYPE)[keyof typeof MESSAGE_CONTENT_TYPE];

export const MESSAGE_STOP_REASON = {
  STOP: "stop",
  TOOL_USE: "toolUse",
} as const;

export type MessageStopReason =
  (typeof MESSAGE_STOP_REASON)[keyof typeof MESSAGE_STOP_REASON];
